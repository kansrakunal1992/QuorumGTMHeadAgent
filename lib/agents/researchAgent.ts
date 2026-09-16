// lib/agents/researchAgent.ts
// ── Research Agent ──────────────────────────────────────────────────────
// Discovers competitors, communities, messaging trends, and distribution
// channels. Every finding must carry provenance — this agent must never
// invent a source, a quote, or a prospect's online activity.
//
// IMPORTANT LIMITATION: unlike this chat session, the deployed agent has no
// built-in web browser. Live web research requires TAVILY_API_KEY (or swap
// in another search API below) — without it, this agent explicitly reports
// "no live web access configured" rather than fabricating findings from the
// model's training data, which is exactly the kind of unsourced claim the
// founder's own product principles (and this spec) prohibit.

import 'server-only'
import { generateJson } from '../ai-client'

interface SearchResult {
  title: string
  url: string
  snippet: string
}

async function tavilySearch(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) return []

  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: 5 }),
  })
  if (!res.ok) return []
  const data = await res.json()
  return (data.results ?? []).map((r: { title: string; url: string; content: string }) => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
  }))
}

export interface ResearchFinding {
  topic: string
  summary: string
  confidence: number
  sources: string[] // URLs — empty array means "no live source, treat as low-confidence model reasoning"
}

const SYNTH_PROMPT = `You are the Research Agent for Quorum's GTM Head. Given raw
search results for a topic, write a 2-4 sentence factual summary using ONLY
what the results actually say. If results are empty, say plainly that no live
source was found rather than guessing. Return ONLY JSON:
{ "summary": string, "confidence": number (0-1) }`

export async function research(topic: string, query: string): Promise<ResearchFinding> {
  const results = await tavilySearch(query)

  if (results.length === 0) {
    return {
      topic,
      summary:
        'No live web search is configured (TAVILY_API_KEY unset), and no cached findings exist for this ' +
        'topic yet — skipping rather than fabricating a source.',
      confidence: 0,
      sources: [],
    }
  }

  const { summary, confidence } = await generateJson<{ summary: string; confidence: number }>(
    SYNTH_PROMPT,
    JSON.stringify({ topic, results })
  )

  return { topic, summary, confidence, sources: results.map((r) => r.url) }
}
