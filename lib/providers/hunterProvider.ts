// lib/providers/hunterProvider.ts
// ── Hunter.io — EmailFinderProvider ──────────────────────────────────────
// Free plan: 50 credits/month, permanent, real API access. Called ONLY for
// prospects that already survived LLM qualification — never for the full
// discovery batch — to make the free allowance last.

import 'server-only'
import type { EmailFinderProvider } from './types'

export const hunterProvider: EmailFinderProvider = {
  name: 'hunter',

  async findEmail(input: { firstName: string; lastName: string; domain: string }) {
    const apiKey = process.env.HUNTER_API_KEY
    if (!apiKey || !input.domain) return { email: null, confidence: 0 }

    const url = new URL('https://api.hunter.io/v2/email-finder')
    url.searchParams.set('domain', input.domain)
    url.searchParams.set('first_name', input.firstName)
    url.searchParams.set('last_name', input.lastName)
    url.searchParams.set('api_key', apiKey)

    const res = await fetch(url.toString())
    if (!res.ok) {
      if (res.status !== 404) console.error('[hunterProvider] findEmail failed', res.status)
      return { email: null, confidence: 0 }
    }

    const data = await res.json()
    const email: string | null = data?.data?.email ?? null
    const score: number = data?.data?.score ?? 0 // Hunter's 0-100 confidence score
    return { email, confidence: score / 100 }
  },
}
