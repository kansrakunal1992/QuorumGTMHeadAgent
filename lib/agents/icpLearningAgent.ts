// lib/agents/icpLearningAgent.ts
// ── ICP Learning Agent ───────────────────────────────────────────────────
//
// This is the piece that actually closes the loop — without it, everything
// attributionAgent.ts records just sits there as data nobody acts on.
// Runs weekly (Monday, piggybacked on the daily cron alongside the content
// digest — see gtmHead.ts). Two jobs, kept deliberately separate because
// they answer different questions:
//
//   1. WHO to target — did prospects sourced under ICP hypothesis A
//      actually convert better than hypothesis B? Updates
//      gtm_icp_hypotheses.confidence/status directly, which is what
//      icpAgent.ts's getSearchTerms() and generateIcpHypotheses() already
//      read — so this doesn't need its own separate read path anywhere
//      else, it just makes the existing one smarter.
//   2. HOW to word it — does the free-session CTA convert better than the
//      paid one, for cold outreach and separately for existing-user
//      nurture (kept apart — a stranger and a known user are very
//      different audiences, combining them would hide the real signal)?
//      Written to gtm_memory as category='messaging', which
//      outreachAgent.ts, nurtureAgent.ts, and contentAgent.ts all now read
//      before drafting.
//
// Honesty over false confidence throughout: every comparison requires a
// minimum sample size before it's allowed to move a number or write a
// learning. Below that, this agent says nothing rather than overfitting to
// 3 data points — the same principle experimentAgent.ts already applies.

import 'server-only'
import { createServiceClient } from '../supabase'
import { recordLearning } from './learningAgent'

const MIN_SAMPLE = 10 // per group being compared — a judgment call for early-stage volume; raise once lead volume is consistently higher

interface HypothesisStats {
  id: string
  description: string
  contacted: number
  converted: number
}

async function updateIcpHypothesisConfidence(): Promise<string | null> {
  const supabase = createServiceClient()

  const { data: prospects } = await supabase
    .from('gtm_prospects')
    .select('icp_hypothesis_id, status, paid_at, free_session_booked_at')
    .not('icp_hypothesis_id', 'is', null)

  if (!prospects || prospects.length === 0) return null

  const byHypothesis = new Map<string, { contacted: number; converted: number }>()
  for (const p of prospects) {
    const id = p.icp_hypothesis_id as string
    const bucket = byHypothesis.get(id) ?? { contacted: 0, converted: 0 }
    if (p.status !== 'new') bucket.contacted++
    if (p.paid_at || p.free_session_booked_at) bucket.converted++
    byHypothesis.set(id, bucket)
  }

  const eligible = [...byHypothesis.entries()].filter(([, b]) => b.contacted >= MIN_SAMPLE)
  if (eligible.length === 0) return null // not enough volume on any single hypothesis yet

  const overallContacted = [...byHypothesis.values()].reduce((s, b) => s + b.contacted, 0)
  const overallConverted = [...byHypothesis.values()].reduce((s, b) => s + b.converted, 0)
  const baselineRate = overallContacted > 0 ? overallConverted / overallContacted : 0

  const summaries: string[] = []

  for (const [hypothesisId, bucket] of eligible) {
    const rate = bucket.converted / bucket.contacted
    const { data: hypothesis } = await supabase
      .from('gtm_icp_hypotheses')
      .select('id, description, confidence, status')
      .eq('id', hypothesisId)
      .maybeSingle()
    if (!hypothesis) continue

    let newConfidence = hypothesis.confidence
    let newStatus = hypothesis.status
    const relative = baselineRate > 0 ? rate / baselineRate : 1

    if (relative >= 1.3) {
      newConfidence = Math.min(0.95, hypothesis.confidence + 0.15)
      newStatus = 'promising'
    } else if (relative <= 0.5 && baselineRate > 0) {
      newConfidence = Math.max(0.1, hypothesis.confidence - 0.15)
      newStatus = 'weak'
    }

    if (newConfidence !== hypothesis.confidence || newStatus !== hypothesis.status) {
      await supabase
        .from('gtm_icp_hypotheses')
        .update({ confidence: newConfidence, status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', hypothesisId)
      summaries.push(
        `"${hypothesis.description.slice(0, 80)}" — ${bucket.converted}/${bucket.contacted} converted ` +
        `(${Math.round(rate * 100)}%, baseline ${Math.round(baselineRate * 100)}%) → confidence ${hypothesis.confidence.toFixed(2)} → ${newConfidence.toFixed(2)}, status → ${newStatus}`
      )
    }
  }

  if (summaries.length === 0) return null

  const content = `ICP hypothesis performance update: ${summaries.join('; ')}.`
  await recordLearning({ category: 'icp', content, source: 'icpLearningAgent', confidence: 0.7 })
  return content
}

async function computeCtaEffectiveness(): Promise<string | null> {
  const supabase = createServiceClient()
  const findings: string[] = []

  // Cold outreach: gtm_prospects.cta_type_used
  const { data: coldRows } = await supabase
    .from('gtm_prospects')
    .select('cta_type_used, paid_at, free_session_booked_at')
    .not('cta_type_used', 'is', null)

  const coldByType = new Map<string, { sent: number; converted: number }>()
  for (const r of coldRows ?? []) {
    const bucket = coldByType.get(r.cta_type_used) ?? { sent: 0, converted: 0 }
    bucket.sent++
    if (r.paid_at || r.free_session_booked_at) bucket.converted++
    coldByType.set(r.cta_type_used, bucket)
  }
  const coldFree = coldByType.get('free_session')
  const coldPaid = coldByType.get('paid_session')
  if (coldFree && coldPaid && coldFree.sent >= MIN_SAMPLE && coldPaid.sent >= MIN_SAMPLE) {
    const freeRate = coldFree.converted / coldFree.sent
    const paidRate = coldPaid.converted / coldPaid.sent
    findings.push(
      `Cold outreach: free_session CTA converts ${(freeRate * 100).toFixed(1)}% (n=${coldFree.sent}) vs ` +
      `paid_session ${(paidRate * 100).toFixed(1)}% (n=${coldPaid.sent}).`
    )
  }

  // Existing-user nurture: gtm_nurture_log.cta_type_used
  const { data: nurtureRows } = await supabase
    .from('gtm_nurture_log')
    .select('cta_type_used, converted_at')
    .not('cta_type_used', 'is', null)

  const nurtureByType = new Map<string, { sent: number; converted: number }>()
  for (const r of nurtureRows ?? []) {
    const bucket = nurtureByType.get(r.cta_type_used) ?? { sent: 0, converted: 0 }
    bucket.sent++
    if (r.converted_at) bucket.converted++
    nurtureByType.set(r.cta_type_used, bucket)
  }
  const nurtureFree = nurtureByType.get('free_session')
  const nurturePaid = nurtureByType.get('paid_session')
  if (nurtureFree && nurturePaid && nurtureFree.sent >= MIN_SAMPLE && nurturePaid.sent >= MIN_SAMPLE) {
    const freeRate = nurtureFree.converted / nurtureFree.sent
    const paidRate = nurturePaid.converted / nurturePaid.sent
    findings.push(
      `Existing-user nurture: free_session CTA converts ${(freeRate * 100).toFixed(1)}% (n=${nurtureFree.sent}) vs ` +
      `paid_session ${(paidRate * 100).toFixed(1)}% (n=${nurturePaid.sent}).`
    )
  }

  if (findings.length === 0) return null

  const content = findings.join(' ')
  await recordLearning({ category: 'messaging', content, source: 'icpLearningAgent', confidence: 0.6 })
  return content
}

export async function runIcpLearningPass(): Promise<string | null> {
  const [icpResult, ctaResult] = await Promise.all([
    updateIcpHypothesisConfidence(),
    computeCtaEffectiveness(),
  ])
  const parts = [icpResult, ctaResult].filter(Boolean)
  return parts.length > 0 ? parts.join(' | ') : null
}
