// lib/agents/analyticsAgent.ts
// ── Analytics Agent ─────────────────────────────────────────────────────
//
// READS ONLY from the main Quorum app's existing tables (sessions,
// mirror_access, decision_session_payments, referrals, auth.users). Never
// writes to them. This is the ONLY source of truth the GTM Head is allowed
// to use for "what actually happened" — it must never invent funnel numbers.
//
// Funnel definition used throughout this project:
//   traffic → signup → first_decision → second_decision → paid
//
// NOTE ON SCALE: at zero/low traffic, per-day counts from admin.listUsers()
// pagination are fine. Once signups grow past a few hundred/day, replace the
// signup-counting block with a proper SQL view over auth.users exposed
// through a Postgres function (schema access for auth.* isn't exposed to
// PostgREST by default) — flagged here rather than over-built now.

import 'server-only'
import { createServiceClient } from '../supabase'
import type { FunnelSnapshot, FunnelBottleneck } from '../types'

function daysAgoIso(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString()
}

async function countSignupsSince(sinceIso: string): Promise<number> {
  const supabase = createServiceClient()
  let page = 1
  let count = 0
  // admin.listUsers is paginated; loop until we run out of pages or pass the window.
  // Bounded to 20 pages (2000 users) as a sane ceiling for this MVP.
  for (page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 })
    if (error || !data?.users?.length) break
    const inWindow = data.users.filter((u) => u.created_at && u.created_at >= sinceIso)
    count += inWindow.length
    if (data.users.length < 100) break // last page
  }
  return count
}

export async function getFunnelSnapshot(): Promise<FunnelSnapshot> {
  const supabase = createServiceClient()
  const since24h = daysAgoIso(1)
  const dateStr = new Date().toISOString().slice(0, 10)

  const signups = await countSignupsSince(since24h)

  const { count: firstDecisionCount } = await supabase
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since24h)

  // "Second decision" = a user's 2nd+ session. Approximated by counting
  // distinct users with >1 session in the trailing 24h vs total sessions —
  // refine once volumes justify a dedicated materialized view.
  const { data: recentSessions } = await supabase
    .from('sessions')
    .select('user_id')
    .gte('created_at', since24h)
    .not('user_id', 'is', null)

  let secondDecision = 0
  if (recentSessions) {
    const byUser = new Map<string, number>()
    for (const row of recentSessions as { user_id: string }[]) {
      byUser.set(row.user_id, (byUser.get(row.user_id) ?? 0) + 1)
    }
    secondDecision = [...byUser.values()].filter((n) => n > 1).length
  }

  const { count: decisionSessionPaid } = await supabase
    .from('decision_session_payments')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'paid')
    .gte('paid_at', since24h)

  const { count: newMirrorAccess } = await supabase
    .from('mirror_access')
    .select('user_id', { count: 'exact', head: true })
    .in('product_tier', ['elite', 'private'])
    .gte('created_at', since24h)

  const { count: activePaying } = await supabase
    .from('mirror_access')
    .select('user_id', { count: 'exact', head: true })
    .in('product_tier', ['elite', 'private'])
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)

  return {
    date: dateStr,
    signups,
    first_decision: firstDecisionCount ?? 0,
    second_decision: secondDecision,
    paid_conversions: (decisionSessionPaid ?? 0) + (newMirrorAccess ?? 0),
    active_paying_users: activePaying ?? 0,
  }
}

/**
 * Diagnose the single biggest funnel bottleneck, following the founder's
 * stated objective hierarchy (paying users > qualified users > activation >
 * second decision > retention > qualified conversations > qualified traffic
 * > awareness). Never pretends small samples are statistically significant
 * — with near-zero volume, defaults to the founder-stated bottleneck.
 */
export function diagnoseBottleneck(snapshot: FunnelSnapshot): { bottleneck: FunnelBottleneck; reasoning: string } {
  if (snapshot.signups === 0) {
    return {
      bottleneck: 'traffic',
      reasoning:
        'Zero signups in the trailing 24h. At this stage sample size is too small to diagnose ' +
        'anything downstream — traffic is the only real leak until people are arriving at all.',
    }
  }
  if (snapshot.first_decision === 0) {
    return {
      bottleneck: 'activation',
      reasoning: `${snapshot.signups} signups but 0 first decisions started — activation is broken before anyone reaches the Council.`,
    }
  }
  const activationRate = snapshot.first_decision / Math.max(1, snapshot.signups)
  if (activationRate < 0.4) {
    return {
      bottleneck: 'activation',
      reasoning: `Activation rate ~${Math.round(activationRate * 100)}% (first_decision/signups) is low — most signups never bring a real decision to the Council.`,
    }
  }
  if (snapshot.paid_conversions === 0 && snapshot.first_decision > 0) {
    return {
      bottleneck: 'conversion',
      reasoning: `${snapshot.first_decision} decisions completed but 0 paid conversions — free experience is working, monetization path is not converting.`,
    }
  }
  if (snapshot.second_decision === 0) {
    return {
      bottleneck: 'second_decision',
      reasoning: 'No repeat sessions yet — users complete one decision and do not return for a second.',
    }
  }
  return {
    bottleneck: 'retention',
    reasoning: 'Core funnel is moving; focus shifts to retention and compounding the Mirror record.',
  }
}
