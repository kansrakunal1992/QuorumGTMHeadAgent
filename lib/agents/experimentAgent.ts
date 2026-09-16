// lib/agents/experimentAgent.ts
// ── Experiment Agent ────────────────────────────────────────────────────
// Ties GTM actions to a falsifiable hypothesis wherever practical, and
// evaluates running experiments against real results — never declares a
// small sample "successful" or "failed".

import 'server-only'
import { createServiceClient } from '../supabase'
import { generateJson } from '../ai-client'
import type { FunnelBottleneck, Experiment } from '../types'

const MIN_SAMPLE_FOR_CONCLUSION = 20

const PROPOSE_PROMPT = `You are the Experiment Agent for Quorum's GTM Head.
Given the current funnel bottleneck and recent learnings, propose ONE new
experiment. Return ONLY JSON: { "name": string, "hypothesis": string,
"problem": string, "audience": string, "channel": "linkedin"|"whatsapp"|"email"|"instagram"|"internal",
"variant": string, "action": string, "metric": string, "baseline": number|null, "target": number|null }`

export async function proposeExperiment(bottleneck: FunnelBottleneck): Promise<Partial<Experiment>> {
  const supabase = createServiceClient()
  const { data: learnings } = await supabase
    .from('gtm_memory')
    .select('content')
    .eq('category', 'learning')
    .eq('status', 'active')
    .order('last_validated_at', { ascending: false })
    .limit(10)

  return generateJson<Partial<Experiment>>(
    PROPOSE_PROMPT,
    JSON.stringify({ bottleneck, recent_learnings: learnings ?? [] })
  )
}

export async function createExperiment(exp: Partial<Experiment>): Promise<string> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('gtm_experiments')
    .insert({ ...exp, status: 'proposed' })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

/**
 * Evaluates a running experiment against `sample_size` real data points.
 * Refuses to conclude anything on too small a sample — returns
 * 'inconclusive' rather than pretending significance.
 */
export function evaluateExperiment(
  result: number,
  baseline: number,
  sampleSize: number
): { status: Experiment['status']; conclusion: string } {
  if (sampleSize < MIN_SAMPLE_FOR_CONCLUSION) {
    return {
      status: 'inconclusive',
      conclusion: `Only ${sampleSize} data points — below the ${MIN_SAMPLE_FOR_CONCLUSION} needed to call this either way. Keep running.`,
    }
  }
  const lift = baseline === 0 ? null : (result - baseline) / baseline
  if (lift === null) {
    return { status: 'inconclusive', conclusion: 'No baseline to compare against yet.' }
  }
  if (lift > 0.1) {
    return { status: 'successful', conclusion: `+${Math.round(lift * 100)}% vs baseline over ${sampleSize} data points.` }
  }
  if (lift < -0.1) {
    return { status: 'failed', conclusion: `${Math.round(lift * 100)}% vs baseline over ${sampleSize} data points.` }
  }
  return { status: 'inconclusive', conclusion: `No meaningful movement (${Math.round(lift * 100)}%) over ${sampleSize} data points.` }
}
