// lib/agents/attributionAgent.ts
// ── Attribution Agent ────────────────────────────────────────────────────
//
// Checks whether GTM Head's own outreach AND nurture actually led anywhere
// real. Cold outreach and existing-user nurture use different utm_source
// values so they can be told apart (see outreachAgent.ts / nurtureAgent.ts):
//
//   1. card_visit_log       (website) — utm_source='gtm_head' → did a cold
//                             prospect land on /kunal or /kunal_elite?
//   2. decision_session_payments (main app, utm already existed) —
//                             utm_source='gtm_head' (cold, matched to
//                             gtm_prospects) OR 'gtm_head_nurture' (existing
//                             user, matched to gtm_nurture_log — that table
//                             has no email/prospect row, decision_session_payments
//                             has no user_id, so utm_content carries the
//                             real user id and gtm_nurture_log is the only
//                             place that can record the match).
//   3. user_profiles.signup_utm_* (main app) — utm_source='gtm_head' → did
//                             a cold prospect sign up for the free tier?
//   4. Google Calendar (free /kunal_elite session) — matched by EMAIL, not
//                             utm, since that booking widget has no param
//                             passthrough. See googleCalendarProvider.ts for
//                             why, and its own gap notes.
//
// This agent only ever WRITES to gtm_prospects / gtm_nurture_log (marking a
// match) and gtm_memory (a learning summary) — never touches source tables.

import 'server-only'
import { createServiceClient } from '../supabase'
import { recordLearning } from './learningAgent'
import { listRecentBookings } from '../providers/googleCalendarProvider'
import type { AttributionSummary } from '../types'

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

export async function runAttributionPass(): Promise<AttributionSummary> {
  const supabase = createServiceClient()
  const summary: AttributionSummary = {
    card_visits: 0, paid_conversions: 0, paid_amount_inr: 0, signups: 0,
    free_session_bookings: 0, nurture_conversions: 0,
  }

  // ── 1. Card visits (cold outreach only) ─────────────────────────────
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

  // ── 2. Paid ₹299 sessions — cold outreach AND nurture ───────────────
  const { data: payments } = await supabase
    .from('decision_session_payments')
    .select('utm_source, utm_content, amount_inr, paid_at')
    .in('utm_source', ['gtm_head', 'gtm_head_nurture'])
    .eq('status', 'paid')

  for (const p of payments ?? []) {
    if (!isUuid(p.utm_content)) continue

    if (p.utm_source === 'gtm_head') {
      const { data: prospect } = await supabase.from('gtm_prospects').select('id, paid_at').eq('id', p.utm_content).maybeSingle()
      if (prospect && !prospect.paid_at) {
        await supabase.from('gtm_prospects').update({ paid_at: p.paid_at, paid_amount_inr: p.amount_inr }).eq('id', p.utm_content)
        summary.paid_conversions++
        summary.paid_amount_inr += p.amount_inr ?? 0
      }
    } else {
      // 'gtm_head_nurture' — utm_content is a real auth user id, recorded
      // against gtm_nurture_log instead (decision_session_payments has no
      // user_id column to join on directly).
      const { data: nurtureRow } = await supabase.from('gtm_nurture_log').select('user_id, converted_at').eq('user_id', p.utm_content).maybeSingle()
      if (nurtureRow && !nurtureRow.converted_at) {
        await supabase.from('gtm_nurture_log').update({ converted_at: p.paid_at, paid_amount_inr: p.amount_inr }).eq('user_id', p.utm_content)
        summary.nurture_conversions++
        summary.paid_amount_inr += p.amount_inr ?? 0
      }
    }
  }

  // ── 3. Free-tier signups (cold outreach only) ───────────────────────
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

  // ── 4. Free session (/kunal_elite) bookings — matched by email ──────
  try {
    const sinceIso = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() // 8-day lookback, safely overlaps daily runs
    const bookings = await listRecentBookings(sinceIso)
    for (const booking of bookings) {
      for (const email of booking.attendeeEmails) {
        const { data: prospect } = await supabase
          .from('gtm_prospects')
          .select('id, free_session_booked_at')
          .eq('email', email)
          .maybeSingle()
        if (prospect && !prospect.free_session_booked_at) {
          await supabase.from('gtm_prospects').update({ free_session_booked_at: booking.createdAt }).eq('id', prospect.id)
          summary.free_session_bookings++
        }
      }
    }
  } catch (err) {
    console.error('[attributionAgent] Google Calendar check failed', err)
  }

  // Only write a learning entry when there's something new to say —
  // avoids a "0 conversions today" line every single day forever.
  const totalNew = summary.card_visits + summary.paid_conversions + summary.signups + summary.free_session_bookings + summary.nurture_conversions
  if (totalNew > 0) {
    await recordLearning({
      category: 'experiment',
      content:
        `Attribution pass: ${summary.card_visits} card visit(s), ${summary.paid_conversions} cold-outreach paid ` +
        `conversion(s), ${summary.nurture_conversions} nurture-driven conversion(s) (total ₹${summary.paid_amount_inr}), ` +
        `${summary.signups} free signup(s), ${summary.free_session_bookings} free-session booking(s) — all traced ` +
        `to specific GTM Head activity.`,
      source: 'attributionAgent',
      confidence: 1,
    })
  }

  return summary
}
