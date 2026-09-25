// lib/agents/icpAgent.ts
// ── ICP Agent ───────────────────────────────────────────────────────────
// Self-generates and refines ICP hypotheses. Never starts from a blank
// slate — always grounds itself in gtm_memory (seeded from the real
// quorumvault.org positioning/pricing/ICP copy, see scripts/seed-memory.ts)
// plus any real prospect/customer evidence accumulated since. Discovering
// genuinely NEW ICP angles is explicitly in scope; it must cite what
// evidence (if any) supports a new hypothesis rather than asserting it.

import 'server-only'
import { createServiceClient } from '../supabase'
import { generateJson } from '../ai-client'
import { POSITIONING_DIRECTIVE } from '../positioning'
import type { ICPHypothesis } from '../types'

const SYSTEM_PROMPT = `You are the ICP Agent for Quorum's autonomous GTM Head.

Quorum is a "judgment compounding system" — it structurally analyzes a real
decision someone is facing, and (on the paid Mirror tier) compounds insight
across a person's decision history over time. It is explicitly NOT
positioned as a chatbot or generic AI advisor.

${POSITIONING_DIRECTIVE}

When you write a hypothesis's "value_proposition", ground it in the
engineering above (e.g. "sees the blind spot your own confidence hides" —
implying calibration tracking — rather than "get advice from 6 experts").

You will be given: (1) current confirmed positioning/ICP facts from
gtm_memory, (2) any real prospect/customer evidence on file, (3) existing ICP
hypotheses already being tracked. Your job is to propose 1-3 ICP hypotheses:
either sharpening an existing one with new evidence, or proposing a genuinely
new angle worth testing. Do not invent evidence — if a hypothesis is a pure
guess with nothing to back it yet, say so plainly and give it low confidence.

Return ONLY a JSON object: { "hypotheses": [ { "description": string,
"pain": string, "trigger": string, "likely_decision_types": string[],
"value_proposition": string, "channels": string[], "confidence": number
(0-1), "evidence": string[], "objections": string[] } ] }`

export async function generateIcpHypotheses(): Promise<Partial<ICPHypothesis>[]> {
  const supabase = createServiceClient()

  const { data: memory } = await supabase
    .from('gtm_memory')
    .select('category, content, confidence, source')
    .in('category', ['positioning', 'icp', 'customer', 'objection'])
    .eq('status', 'active')
    .order('confidence', { ascending: false })
    .limit(40)

  const { data: existing } = await supabase
    .from('gtm_icp_hypotheses')
    .select('description, status, confidence')
    .order('confidence', { ascending: false })
    .limit(20)

  const userPrompt = JSON.stringify({
    confirmed_facts: memory ?? [],
    existing_hypotheses: existing ?? [],
  })

  const result = await generateJson<{ hypotheses: Partial<ICPHypothesis>[] }>(SYSTEM_PROMPT, userPrompt)
  return result.hypotheses ?? []
}

const SEARCH_TERMS_PROMPT = `You are helping build a prospect search query for Quorum's GTM Head.

Given the current ICP hypotheses and confirmed positioning facts, produce
job titles and keywords suitable for a people-search API filter (like
Apollo's person_titles / q_keywords). Titles should be realistic LinkedIn
job titles a founder/CXO/family-office principal would actually hold —
not vague categories. Return ONLY JSON:
{ "titles": string[] (8-15 titles), "keywords": string[] (3-6 short keyword phrases) }`

/**
 * Derives Apollo-style search titles/keywords from the current ICP
 * hypotheses + confirmed positioning in gtm_memory, so the search terms
 * evolve as the ICP does rather than being hardcoded once.
 */
export async function getSearchTerms(): Promise<{ titles: string[]; keywords: string[]; topHypothesisId: string | null }> {
  const supabase = createServiceClient()
  const [{ data: hypotheses }, { data: memory }] = await Promise.all([
    supabase
      .from('gtm_icp_hypotheses')
      .select('id, description, likely_decision_types, value_proposition, status, confidence')
      .neq('status', 'rejected')
      .order('confidence', { ascending: false })
      .limit(10),
    supabase
      .from('gtm_memory')
      .select('content')
      .eq('category', 'icp')
      .eq('status', 'active')
      .limit(10),
  ])

  const result = await generateJson<{ titles: string[]; keywords: string[] }>(
    SEARCH_TERMS_PROMPT,
    JSON.stringify({ icp_hypotheses: hypotheses ?? [], confirmed_icp_facts: memory ?? [] })
  )

  // Whichever hypothesis most informed this search (highest confidence,
  // since that's what's fed to the model first) is what today's discovered
  // prospects get tagged with — an approximation, not per-prospect
  // precision, but enough for the Learning Agent to later ask "did THIS
  // hypothesis's prospects actually convert better than average?"
  const topHypothesisId: string | null = hypotheses?.[0]?.id ?? null

  return {
    titles: result.titles?.length ? result.titles : ['Founder', 'Co-Founder', 'CEO', 'Managing Partner'],
    keywords: result.keywords ?? [],
    topHypothesisId,
  }
}

export async function persistIcpHypotheses(hypotheses: Partial<ICPHypothesis>[]): Promise<number> {
  if (hypotheses.length === 0) return 0
  const supabase = createServiceClient()
  const rows = hypotheses.map((h) => ({
    description: h.description,
    pain: h.pain,
    trigger: h.trigger,
    likely_decision_types: h.likely_decision_types ?? [],
    value_proposition: h.value_proposition,
    channels: h.channels ?? [],
    confidence: h.confidence ?? 0.3,
    evidence: h.evidence ?? [],
    objections: h.objections ?? [],
    status: 'testing' as const,
    source: 'agent_generated' as const,
  }))
  const { error } = await supabase.from('gtm_icp_hypotheses').insert(rows)
  if (error) throw error
  return rows.length
}
