// lib/agents/productAgent.ts
// ── Product Agent ────────────────────────────────────────────────────────
// The GTM Head can only execute GTM actions (content, outreach, research,
// experiments) — it has no ability to change pricing, onboarding, or the
// product itself. But its daily view of the real funnel + real objections
// often surfaces things that ARE product problems, not marketing problems.
// This agent's only job is to say so plainly when warranted, and stay quiet
// otherwise — it must not manufacture a recommendation just to have one.

import 'server-only'
import { createServiceClient } from '../supabase'
import { generateJson } from '../ai-client'
import type { FunnelBottleneck, ProductRecommendation, FunnelSnapshot } from '../types'

const SYSTEM_PROMPT = `You are the Product Agent for Quorum's GTM Head.

Your ONLY job: decide whether today's real funnel data and recent GTM
findings point to a genuine PRODUCT problem (pricing, onboarding, UX,
positioning, or a missing feature) — something no amount of marketing
activity can fix, because the product/experience itself is the blocker.

Be conservative. Most days there is nothing new to say — if so, return
has_recommendation: false. Do not repeat a recommendation that's already
pending (you'll be shown those). Do not recommend a marketing/content/
outreach action — that's a different agent's job; stay in your lane.

Return ONLY JSON: { "has_recommendation": boolean, "category":
"pricing"|"onboarding"|"ux"|"positioning"|"feature"|"other"|null,
"recommendation": string|null, "rationale": string|null,
"confidence": number|null }`

export async function proposeProductRecommendation(
  bottleneck: FunnelBottleneck,
  reasoning: string,
  snapshot: FunnelSnapshot
): Promise<Partial<ProductRecommendation> | null> {
  const supabase = createServiceClient()

  const [{ data: pending }, { data: recentFindings }] = await Promise.all([
    supabase
      .from('gtm_product_recommendations')
      .select('recommendation')
      .eq('state', 'pending')
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('gtm_activity_log')
      .select('action_type, reason, result')
      .in('action_type', ['research', 'experiment_analysis', 'funnel_diagnosis'])
      .order('timestamp', { ascending: false })
      .limit(10),
  ])

  const result = await generateJson<{
    has_recommendation: boolean
    category: ProductRecommendation['category'] | null
    recommendation: string | null
    rationale: string | null
    confidence: number | null
  }>(
    SYSTEM_PROMPT,
    JSON.stringify({
      bottleneck,
      bottleneck_reasoning: reasoning,
      funnel_snapshot: snapshot,
      recent_gtm_findings: recentFindings ?? [],
      already_pending_recommendations: (pending ?? []).map((p) => p.recommendation),
    })
  )

  if (!result.has_recommendation || !result.recommendation) return null

  return {
    category: result.category ?? 'other',
    recommendation: result.recommendation,
    rationale: result.rationale ?? '',
    confidence: result.confidence ?? 0.5,
    evidence: [],
  }
}
