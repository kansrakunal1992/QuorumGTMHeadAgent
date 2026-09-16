// lib/providers/apolloProvider.ts
// ── Apollo — ProspectSearchProvider ──────────────────────────────────────
//
// KNOWN LIMITATION (confirmed against a real Free-plan account, Sept 2026):
// the People Search endpoint this file calls (mixed_people/search, shown in
// Apollo's own API-key permission screen as "mixed_people/api_search") is
// NOT available on Apollo's Free plan — not a scoping issue, it's excluded
// even with a master key. It only unlocks on a paid plan (Basic, $49/mo+).
//
// Until you upgrade, this function will 403 — that's expected. The free
// path is app/api/prospects/import (search manually in Apollo's UI, paste
// the CSV export into the dashboard); everything downstream of discovery
// (qualification, Hunter enrichment, outreach drafting) is unaffected. Once
// you're on a paid Apollo plan, this file works as-is with no changes.
//
// Uses ONLY the People Search endpoint — deliberately does not call
// Apollo's people/match (enrich/reveal) endpoint, which is paid-plan-gated
// and burns credits fast. Email discovery is left to Hunter (hunterProvider.ts),
// which has a real, separate free allowance.
//
// VERIFY BEFORE RELYING ON THIS: Apollo's API surface does shift over time.
// Cross-check the endpoint path and request shape against
// https://docs.apollo.io/reference before your first real run — this is
// written against Apollo's documented People Search API as of mid-2026.

import 'server-only'
import type { ProspectSearchProvider, ProspectSearchParams, RawSearchResult } from './types'
import type { ProspectRegion } from '../types'

const APOLLO_BASE_URL = 'https://api.apollo.io/api/v1'

// Apollo's location filter takes free-text place strings, not region codes —
// this is a reasonable default spread per region; tune freely.
export const REGION_LOCATIONS: Record<ProspectRegion, string[]> = {
  IN: ['India'],
  US: ['United States'],
  EU: ['United Kingdom', 'Germany', 'France', 'Netherlands', 'Ireland', 'Spain', 'Italy', 'Sweden'],
  AE: ['United Arab Emirates'],
}

interface ApolloPersonResult {
  id: string
  name: string
  title?: string
  linkedin_url?: string
  email?: string | null
  organization?: { name?: string; primary_domain?: string } | null
  city?: string
  state?: string
  country?: string
}

export const apolloProvider: ProspectSearchProvider = {
  name: 'apollo',

  async search(params: ProspectSearchParams): Promise<RawSearchResult[]> {
    const apiKey = process.env.APOLLO_API_KEY
    if (!apiKey) return []

    const perPage = Math.min(params.perPage ?? 10, 25) // keep pages small — free credits are scarce

    const res = await fetch(`${APOLLO_BASE_URL}/mixed_people/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        person_titles: params.titles,
        person_locations: params.locations,
        q_keywords: params.keywords?.join(' '),
        page: 1,
        per_page: perPage,
      }),
    })

    if (!res.ok) {
      console.error('[apolloProvider] search failed', res.status, await res.text().catch(() => ''))
      return []
    }

    const data = await res.json()
    const people: ApolloPersonResult[] = data.people ?? []

    return people.map((p) => ({
      external_id: p.id,
      name: p.name,
      title: p.title ?? null,
      company: p.organization?.name ?? null,
      company_domain: p.organization?.primary_domain ?? null,
      geography: [p.city, p.state, p.country].filter(Boolean).join(', ') || null,
      linkedin_url: p.linkedin_url ?? null,
      email: p.email ?? null, // typically null/locked on free plan — Hunter fills this in
      provenance: `apollo_search`,
    }))
  },
}
