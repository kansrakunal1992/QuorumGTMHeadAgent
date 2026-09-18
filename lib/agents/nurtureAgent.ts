// lib/agents/nurtureAgent.ts
// ── Nurture Agent — existing users, not cold prospects ──────────────────
//
// Deliberately narrow, by design, per the proposal this was built from:
//   - Audience: users with EXACTLY 1 or 2 completed sessions, no active
//     mirror_access. Zero-session users are already daily-nudge's
//     territory; ≥3-session users are already mirror-insight-email's
//     territory. This targets the one segment neither covers.
//   - One-time ONLY, ever, per user — gtm_nurture_log is the permanent
//     idempotency guard, not a decaying/recurring sequence.
//   - Respects the main app's shared nudge gate (notification_log) —
//     read-only check, never writes into that table, never modifies the
//     main app's own throttle logic.
//   - Shares the same GTM_EMAIL_AUTONOMOUS master switch and Resend
//     infrastructure as cold outreach — no separate on/off flag to manage.

import 'server-only'
import { createServiceClient } from '../supabase'
import { generateJson } from '../ai-client'
import { sendEmail } from '../providers/resendProvider'
import { QUORUM_FREE_SESSION_URL, QUORUM_BOOKING_URL } from '../config'
import { nextSendTime } from '../sendTiming'

const SHARED_GATE_DAYS = 3 // matches lib/notification-throttle.ts's SHARED_NUDGE_GATE_DAYS in the main app

interface NurtureCandidate {
  user_id: string
  email: string
  session_count: number
}

async function findCandidates(limit: number): Promise<NurtureCandidate[]> {
  const supabase = createServiceClient()

  // NOTE ON SCALE: client-side aggregation of session rows, same pragmatic
  // approach as analyticsAgent's signup counting — fine at current volumes,
  // revisit with a Postgres view/function once this table is large.
  const { data: sessionRows } = await supabase.from('sessions').select('user_id').not('user_id', 'is', null)
  const counts = new Map<string, number>()
  for (const row of (sessionRows ?? []) as { user_id: string }[]) {
    counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1)
  }
  const eligible = [...counts.entries()].filter(([, c]) => c === 1 || c === 2).map(([id]) => id)
  if (eligible.length === 0) return []

  const { data: mirrorRows } = await supabase.from('mirror_access').select('user_id').in('user_id', eligible)
  const hasMirror = new Set((mirrorRows ?? []).map((r) => r.user_id))
  const noMirror = eligible.filter((id) => !hasMirror.has(id))
  if (noMirror.length === 0) return []

  const { data: nurtured } = await supabase.from('gtm_nurture_log').select('user_id').in('user_id', noMirror)
  const nurturedSet = new Set((nurtured ?? []).map((r) => r.user_id))
  const notYetNurtured = noMirror.filter((id) => !nurturedSet.has(id))
  if (notYetNurtured.length === 0) return []

  // Read-only respect of the main app's shared gate — never written to.
  const cutoff = new Date(Date.now() - SHARED_GATE_DAYS * 86_400_000).toISOString()
  const { data: recentlyNudged } = await supabase
    .from('notification_log')
    .select('user_id')
    .in('user_id', notYetNurtured)
    .gte('sent_at', cutoff)
  const nudgedSet = new Set((recentlyNudged ?? []).map((r) => r.user_id))
  const safe = notYetNurtured.filter((id) => !nudgedSet.has(id)).slice(0, limit)
  if (safe.length === 0) return []

  const candidates: NurtureCandidate[] = []
  for (const userId of safe) {
    const { data: userResult } = await supabase.auth.admin.getUserById(userId)
    const email = userResult?.user?.email
    if (email) candidates.push({ user_id: userId, email, session_count: counts.get(userId) ?? 1 })
  }
  return candidates
}

interface NurtureDraft {
  subject: string
  message: string
  cta_type: 'free_session' | 'paid_session'
}

const SYSTEM_PROMPT = `You are writing a one-time, personal, founder-voice
check-in email for Quorum ("judgment compounding system", not a chatbot).
This specific person already used the free product for real (ran 1-2
decisions) but hasn't come back or paid. This is NOT a generic
re-engagement nudge and NOT a value-teaser — it's a direct, warm, human
invitation from the founder to go deeper, e.g. "I noticed you ran a
decision through Quorum — want to do a real one together?" Keep it short.
No hard sell, no fake urgency. Default to "free_session" as the CTA unless
there's a specific reason in the input to believe paid is a better fit —
default to free.
Return ONLY JSON: { "subject": string, "message": string, "cta_type": "free_session"|"paid_session" }`

export interface NurtureRunResult {
  candidates: number
  sent: number
}

export async function runNurturePass(dailyLimit: number): Promise<NurtureRunResult> {
  if (process.env.GTM_EMAIL_AUTONOMOUS !== 'true') {
    return { candidates: 0, sent: 0 } // same master switch as cold outreach — nothing sends without it
  }

  const supabase = createServiceClient()
  const candidates = await findCandidates(dailyLimit)
  let sent = 0

  for (const candidate of candidates) {
    try {
      const draft = await generateJson<NurtureDraft>(SYSTEM_PROMPT, JSON.stringify({ session_count: candidate.session_count }))

      const ctaBase = draft.cta_type === 'paid_session' ? QUORUM_BOOKING_URL : QUORUM_FREE_SESSION_URL
      const ctaUrl = new URL(ctaBase)
      // Distinct utm_source from cold outreach ('gtm_head_nurture' vs
      // 'gtm_head') so the Attribution Agent can tell existing-user
      // nurture conversions apart from cold-outreach ones.
      ctaUrl.searchParams.set('utm_source', 'gtm_head_nurture')
      ctaUrl.searchParams.set('utm_campaign', 'existing_user_nurture')
      ctaUrl.searchParams.set('utm_content', candidate.user_id)

      const result = await sendEmail({
        to: candidate.email,
        subject: draft.subject,
        text: `${draft.message}\n\n${ctaUrl.toString()}`,
        replyTo: process.env.GTM_EMAIL_REPLY_TO || undefined,
        scheduledAt: nextSendTime(null),
      })

      if (result.ok) {
        await supabase.from('gtm_nurture_log').insert({ user_id: candidate.user_id, session_count_at_send: candidate.session_count })
        sent++
      }
      // A failed send is NOT recorded in gtm_nurture_log — it stays
      // eligible and will be retried on a future run, unlike cold outreach
      // (which falls back to a Founder Action instead — there's no
      // equivalent "ask the founder to send this one manually" queue for
      // an existing-user nurture email).
    } catch (err) {
      console.error('[nurtureAgent] failed for', candidate.user_id, err)
    }
  }

  return { candidates: candidates.length, sent }
}
