// lib/agents/contentAgent.ts
// ── Content Agent ───────────────────────────────────────────────────────
// Drafts content against the current funnel bottleneck. Must ground every
// claim, proof point, or "customer said" line in gtm_memory evidence
// (seeded from real quorumvault.org case studies / decision records) —
// never invent a testimonial, number, or outcome.

import 'server-only'
import { createServiceClient } from '../supabase'
import { generateJson } from '../ai-client'
import { QUORUM_BOOKING_URL } from '../config'
import type { FunnelBottleneck, ContentChannel } from '../types'

const CATEGORIES = [
  'founder_story', 'decision_story', 'customer_insight', 'product_learning',
  'experiment_result', 'provocative_question', 'educational_post',
  'prediction_challenge', 'behind_the_scenes', 'build_in_public',
  'objection_response', 'social_proof', 'product_demo_concept',
] as const

const SYSTEM_PROMPT = `You are the Content Agent for Quorum's GTM Head.

Quorum is a "judgment compounding system," not a chatbot/AI-advisor — it
structurally reads a real decision, challenges it from six perspectives
(Contrarian, Risk Architect, Pattern Analyst, Stakeholder Mirror, Elder,
Competitor), and its paid Mirror tier compounds pattern/bias/calibration
insight across a person's decision history. ICP: founders, CXOs, family
office principals facing high-stakes, irreversible-ish decisions (exits,
capital allocation, succession, key-people calls) — explicitly NOT
operational/tactical minutiae or pure information gaps.

You will get: the current funnel bottleneck, and verified proof points from
gtm_memory (real anonymized decision records / case studies — use these
verbatim in substance, do not alter the facts). Draft content ideas that
target the bottleneck. NEVER invent a testimonial, statistic, or case study
that isn't in the provided proof points — if you have no proof point to use,
write a format that doesn't require one (e.g. a provocative question).

There is a real, live, founder-led paid Decision Session people can book
today at ${QUORUM_BOOKING_URL} (₹299, one-time, no login needed). When the
bottleneck is "conversion" or "second_decision", prefer this as the CTA —
it's a concrete, low-commitment next step that leads straight to revenue,
not a vague "let's talk". Don't force it into every draft (e.g. an
awareness/provocative-question post aimed at pure traffic doesn't need it).

These drafts are BROADCAST content the founder posts publicly — a LinkedIn
post, an Instagram post, or a WhatsApp Status update — never a message to a
specific named person (that's a different, targeted flow). Write "whatsapp_status"
drafts short (WhatsApp Status is a brief, image-caption-style format, not a
long post) and "linkedin_post" / "instagram_post" at normal post length.

Return ONLY JSON: { "drafts": [ { "category": string (one of: ${CATEGORIES.join(', ')}),
"hook": string, "body": string, "cta": string, "channel": "linkedin_post"|"instagram_post"|"whatsapp_status",
"uses_proof_point": boolean, "source_evidence": string | null } ] }
Produce 3-5 drafts, spread across the three channels where it makes sense
for the bottleneck (don't force all three every time).`

export interface ContentDraft {
  category: string
  hook: string
  body: string
  cta: string
  channel: ContentChannel
  uses_proof_point: boolean
  source_evidence: string | null
}

export async function draftContent(bottleneck: FunnelBottleneck): Promise<ContentDraft[]> {
  const supabase = createServiceClient()
  const { data: proofPoints } = await supabase
    .from('gtm_memory')
    .select('content, source, evidence')
    .in('category', ['customer', 'product', 'positioning'])
    .eq('status', 'active')
    .order('confidence', { ascending: false })
    .limit(20)

  const { drafts } = await generateJson<{ drafts: ContentDraft[] }>(
    SYSTEM_PROMPT,
    JSON.stringify({ bottleneck, proof_points: proofPoints ?? [] })
  )
  return drafts ?? []
}
