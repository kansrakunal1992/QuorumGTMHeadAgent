// lib/agents/dailyPlanningAgent.ts
// ── Daily Planning Agent ────────────────────────────────────────────────
// Turns "here's the bottleneck" into a concrete, capped list of today's
// actions, using:
//   Expected Impact = P(success) × upside × strategic_relevance × evidence_strength / effort
// scored by the LLM per candidate (0-10 scale), then filtered against
// whatever daily caps remain right now.

import 'server-only'
import { generateJson } from '../ai-client'
import { getRemaining } from '../limits'
import type { FunnelBottleneck } from '../types'

export interface CandidateAction {
  action: string
  action_type: 'research' | 'icp' | 'content' | 'prospecting' | 'outreach' | 'experiment'
  expected_impact: number // 0-10, from the model
  reasoning: string
}

const SCORE_PROMPT = `You are the GTM Head's Daily Planning Agent for Quorum.

Objective hierarchy (in order): 1) recurring paying users 2) qualified users
3) activation 4) second decision 5) retention 6) qualified conversations
7) qualified traffic 8) awareness. NEVER default to "post more content" or
"send more messages" just because they're easy — only propose actions that
plausibly address the CURRENT bottleneck.

Given the current bottleneck and remaining daily budget by category,
propose 3-6 candidate actions for today. Score each 0-10 on:
P(success) × expected upside × strategic relevance × evidence strength,
divided qualitatively by effort/cost — fold all of that into one
"expected_impact" number, 0-10, and explain briefly why.

Return ONLY JSON: { "candidates": [ { "action": string, "action_type":
"research"|"icp"|"content"|"prospecting"|"outreach"|"experiment",
"expected_impact": number, "reasoning": string } ] }`

export async function scoreCandidateActions(bottleneck: FunnelBottleneck): Promise<CandidateAction[]> {
  const remaining = {
    prospects_researched: await getRemaining('prospects_researched'),
    outreach_messages: await getRemaining('outreach_messages'),
    experiments: await getRemaining('experiments'),
    linkedin_posts: await getRemaining('linkedin_posts'),
    competitor_research: await getRemaining('competitor_research'),
  }

  const { candidates } = await generateJson<{ candidates: CandidateAction[] }>(
    SCORE_PROMPT,
    JSON.stringify({ bottleneck, remaining_budget: remaining })
  )
  return (candidates ?? []).sort((a, b) => b.expected_impact - a.expected_impact)
}
