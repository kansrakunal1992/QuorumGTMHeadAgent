// lib/ai-client.ts
// ── LLM provider abstraction ──────────────────────────────────────────────
//
// Default provider: DeepSeek V4 Pro (model id `deepseek-v4-pro`, GA since
// Aug 13 2026), reached through the OpenAI-compatible SDK at
// https://api.deepseek.com — this is DeepSeek's own documented integration
// path, not a workaround.
//
// Not tightly coupled to DeepSeek: swap AI_PROVIDER to point this at any
// OpenAI-compatible endpoint (including Anthropic-via-proxy or a self-hosted
// model) without touching any agent code — agents only ever call
// `generateJson` / `generateText` below.

import 'server-only'
import OpenAI from 'openai'

type Provider = 'deepseek' | 'openai_compatible'

function getProvider(): Provider {
  const raw = (process.env.AI_PROVIDER ?? 'deepseek').toLowerCase()
  return raw === 'openai_compatible' ? 'openai_compatible' : 'deepseek'
}

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (client) return client

  const provider = getProvider()

  if (provider === 'deepseek') {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) throw new Error('Missing DEEPSEEK_API_KEY')
    client = new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com' })
  } else {
    const apiKey = process.env.AI_PROVIDER_API_KEY
    const baseURL = process.env.AI_PROVIDER_BASE_URL
    if (!apiKey || !baseURL) throw new Error('Missing AI_PROVIDER_API_KEY / AI_PROVIDER_BASE_URL')
    client = new OpenAI({ apiKey, baseURL })
  }
  return client
}

function getModel(): string {
  const provider = getProvider()
  if (provider === 'deepseek') return process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro'
  return process.env.AI_PROVIDER_MODEL || 'gpt-4o-mini'
}

/** Plain text completion. */
export async function generateText(systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await getClient().chat.completions.create({
    model: getModel(),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  })
  return res.choices[0]?.message?.content ?? ''
}

/**
 * JSON-structured completion. Caller passes a system prompt that must
 * explicitly instruct the model to return ONLY JSON, no preamble/markdown —
 * DeepSeek honors `response_format: json_object` but the instruction should
 * still be explicit in the prompt as a second line of defense.
 */
export async function generateJson<T>(systemPrompt: string, userPrompt: string): Promise<T> {
  const res = await getClient().chat.completions.create({
    model: getModel(),
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  })
  const raw = res.choices[0]?.message?.content ?? '{}'
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error(`AI response was not valid JSON: ${raw.slice(0, 200)}`)
  }
}
