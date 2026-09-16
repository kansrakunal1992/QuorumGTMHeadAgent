// lib/agents/learningAgent.ts
// ── Learning / Memory Agent ─────────────────────────────────────────────
// The only agent allowed to write to gtm_memory. Deliberately conservative:
// only persists structured, evidence-backed learnings — never a raw LLM
// musing. Founder feedback on a Founder Action always becomes a
// founder_preference memory row, since that's the founder's own explicit
// signal, not something to second-guess.

import 'server-only'
import { createServiceClient } from '../supabase'
import type { GtmMemoryItem } from '../types'

export async function recordLearning(input: {
  category: GtmMemoryItem['category']
  content: string
  source: string
  confidence: number
  evidence?: string[]
}): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('gtm_memory').insert({
    category: input.category,
    content: input.content,
    source: input.source,
    confidence: input.confidence,
    evidence: input.evidence ?? [],
  })
  if (error) throw error
}

/** Founder tapped a feedback button on a Founder Action / activity item. */
export async function recordFounderFeedback(feedback: {
  founder_action_id?: string
  activity_id?: string
  label: 'good' | 'bad' | 'too_aggressive' | 'too_generic' | 'wrong_icp' | 'good_target_bad_message' | 'do_more' | 'never_again'
  note?: string
}): Promise<void> {
  await recordLearning({
    category: 'founder_preference',
    content: `Founder feedback: ${feedback.label}${feedback.note ? ` — ${feedback.note}` : ''}`,
    source: feedback.founder_action_id
      ? `founder_action:${feedback.founder_action_id}`
      : `activity:${feedback.activity_id}`,
    confidence: 1, // founder's own direct signal
  })
}
