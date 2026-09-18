// lib/agents/digestAgent.ts
// ── Digest Agent ─────────────────────────────────────────────────────────
// Runs weekly (Mondays, piggybacked on the daily cron — see gtmHead.ts).
// Turns a week of manually-logged content performance (gtm_content_performance)
// into ONE actual learning, so the Performance Log tab feeds back into what
// the Content Agent does next, rather than just sitting there as a table
// nobody reads. Stays quiet (returns null) if there's too little data to
// say anything real — never manufactures a pattern from 2 data points.

import 'server-only'
import { createServiceClient } from '../supabase'
import { generateJson } from '../ai-client'
import { recordLearning } from './learningAgent'

const MIN_LOGGED_ITEMS = 3 // below this, don't pretend there's a pattern

const DIGEST_PROMPT = `You are summarizing a week of manually-logged content
performance for Quorum's GTM Head (LinkedIn/Instagram posts, WhatsApp
Status — impressions, engagement, link clicks, each tagged with a content
category and channel). Find ONE genuinely useful pattern (e.g. "category X
on channel Y outperforms category Z by N%") if the data actually supports
it. If the data is too thin, noisy, or all similar to say anything real,
say so plainly — do not force a conclusion.

Return ONLY JSON: { "has_finding": boolean, "finding": string|null }`

export async function runWeeklyDigest(): Promise<string | null> {
  const supabase = createServiceClient()
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: rows } = await supabase
    .from('gtm_content_performance')
    .select('impressions, engagement, link_clicks, as_of_date, content_id, gtm_content_queue(channel, category)')
    .gte('as_of_date', sevenDaysAgo.slice(0, 10))

  if (!rows || rows.length < MIN_LOGGED_ITEMS) {
    return null // not enough logged data yet — nothing to say, and that's fine
  }

  const result = await generateJson<{ has_finding: boolean; finding: string | null }>(
    DIGEST_PROMPT,
    JSON.stringify(rows)
  )

  if (!result.has_finding || !result.finding) return null

  await recordLearning({
    category: 'messaging',
    content: `Weekly content digest: ${result.finding}`,
    source: 'digestAgent (gtm_content_performance, trailing 7 days)',
    confidence: rows.length >= 8 ? 0.6 : 0.4,
  })

  return `Weekly digest: ${result.finding}`
}
