// lib/agents/attributionAgent.ts
// ── Attribution Agent ────────────────────────────────────────────────────
//
// The one agent whose entire job is checking whether GTM Head's own outreach
// actually led anywhere real. Reads three sources, all tagged utm_source =
// 'gtm_head' and matched back to a prospect via utm_content = gtm_prospects.id
// (see outreachAgent.ts's trackedCtaUrl):
//
//   1. card_visit_log       (website's own Supabase table, added alongside
//                             this build) — did they land on /kunal or
//                             /kunal_elite at all?
//   2. decision_session_payments (main app) — did the ₹299 session convert?
//                             Full attribution: this table already existed
//                             and already captured utm_source/campaign/content
//                             before this project touched anything.
//   3. user_profiles.signup_utm_* (main app, added alongside this build) —
//                             did they sign up for the free tier?
//
// Known gap, stated plainly rather than faked: /kunal_elite (the FREE
// session) has no equivalent to decision_session_payments — a booking
// there only exists inside Kunal's Google Calendar, invisible to this
// query. card_visit_log is the best available signal for that page until
// a Calendar API integration exists.
//
// This agent only ever WRITES to gtm_prospects (marking a match) and
// gtm_memory (a learning summary) — it never touches the source tables.

import 'server-only'
import { createServiceClient } from '../supabase'
import { recordLearning } from './learningAgent'
import type { AttributionSummary } from '../types'

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

export async function runAttributionPass(): Promise<AttributionSummary> {
  const supabase = createServiceClient()
  const summary: AttributionSummary = { card_visits: 0, paid_conversions: 0, paid_amount_inr: 0, signups: 0 }

  // ── 1. Card visits ───────────────────────────────────────────────────
  const { data: visits } = await supabase
    .from('card_visit_log')
    .select('utm_content, card, created_at')
    .eq('utm_source', 'gtm_head')

  for (const v of visits ?? []) {
    if (!isUuid(v.utm_content)) continue
    const { data: prospect } = await supabase
      .from('gtm_prospects')
      .select('id, card_visited_at')
      .eq('id', v.utm_content)
      .maybeSingle()
    if (prospect && !prospect.card_visited_at) {
      await supabase
        .from('gtm_prospects')
        .update({ card_visited_at: v.created_at, card_visited: v.card })
        .eq('id', v.utm_content)
      summary.card_visits++
    }
  }

  // ── 2. Paid ₹299 sessions ────────────────────────────────────────────
  const { data: payments } = await supabase
    .from('decision_session_payments')
    .select('utm_content, amount_inr, paid_at')
    .eq('utm_source', 'gtm_head')
    .eq('status', 'paid')

  for (const p of payments ?? []) {
    if (!isUuid(p.utm_content)) continue
    const { data: prospect } = await supabase
      .from('gtm_prospects')
      .select('id, paid_at')
      .eq('id', p.utm_content)
      .maybeSingle()
    if (prospect && !prospect.paid_at) {
      await supabase
        .from('gtm_prospects')
        .update({ paid_at: p.paid_at, paid_amount_inr: p.amount_inr })
        .eq('id', p.utm_content)
      summary.paid_conversions++
      summary.paid_amount_inr += p.amount_inr ?? 0
    }
  }

  // ── 3. Free-tier signups ─────────────────────────────────────────────
  const { data: signups } = await supabase
    .from('user_profiles')
    .select('signup_utm_content, created_at')
    .eq('signup_utm_source', 'gtm_head')

  for (const s of signups ?? []) {
    if (!isUuid(s.signup_utm_content)) continue
    const { data: prospect } = await supabase
      .from('gtm_prospects')
      .select('id, signed_up_at')
      .eq('id', s.signup_utm_content)
      .maybeSingle()
    if (prospect && !prospect.signed_up_at) {
      await supabase.from('gtm_prospects').update({ signed_up_at: s.created_at ?? new Date().toISOString() }).eq('id', s.signup_utm_content)
      summary.signups++
    }
  }

  // Only write a learning entry when there's something new to say —
  // avoids a "0 conversions today" line every single day forever.
  if (summary.card_visits + summary.paid_conversions + summary.signups > 0) {
    await recordLearning({
      category: 'experiment',
      content:
        `Attribution pass: ${summary.card_visits} new card visit(s), ${summary.paid_conversions} new paid ` +
        `conversion(s) (₹${summary.paid_amount_inr}), ${summary.signups} new free signup(s) — all traced ` +
        `to specific GTM Head outreach via utm_content.`,
      source: 'attributionAgent',
      confidence: 1,
    })
  }

  return summary
}
