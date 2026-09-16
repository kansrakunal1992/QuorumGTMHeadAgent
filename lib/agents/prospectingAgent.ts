// lib/agents/prospectingAgent.ts
// ── Prospecting Agent ────────────────────────────────────────────────────
//
// Pipeline (deliberately in this order, to spend the free Hunter/Apollo
// allowances on quality, not volume):
//
//   1. DISCOVER  — Apollo People Search, per region, small page sizes
//   2. DEDUPE    — drop anything already in gtm_prospects
//   3. QUALIFY   — DeepSeek scores each candidate against real ICP evidence;
//                  only the top `prospects_qualified` survive
//   4. ENRICH    — Hunter email-finder, ONLY for qualified survivors
//   5. PERSIST   — insert into gtm_prospects with fit_score + provenance
//
// If APOLLO_API_KEY is unset, this is a documented no-op (never invents
// prospects) — same principle as before, just now with a real path when
// the key is present.

import 'server-only'
import { createServiceClient } from '../supabase'
import { generateJson } from '../ai-client'
import { getProspectRegions } from '../config'
import { apolloProvider, REGION_LOCATIONS } from '../providers/apolloProvider'
import { hunterProvider } from '../providers/hunterProvider'
import { getSearchTerms } from './icpAgent'
import type { RawSearchResult } from '../providers/types'
import type { Prospect, ProspectRegion } from '../types'

interface QualifiedCandidate extends RawSearchResult {
  fit_score: number
  reasoning: string
}

const QUALIFY_PROMPT = `You are the ICP qualification step of Quorum's GTM Head.

Quorum is a "judgment compounding system" for founders, CXOs, and family
office principals facing high-stakes, hard-to-reverse decisions (exits,
capital allocation, succession, key-people calls) — NOT for people who just
need information or have an operational/tactical question.

Given a batch of candidate people (name, title, company, geography — no
guaranteed contact info yet), score each 0-1 on how well they plausibly fit
that ICP based on title/seniority/company signal alone, and give a one-line
reason. Be conservative — a generic "Manager" title should score low; a
"Founder & CEO" or "Managing Partner" should score higher.

Return ONLY JSON: { "scores": [ { "external_id": string, "fit_score": number, "reasoning": string } ] }`

async function qualify(candidates: RawSearchResult[]): Promise<QualifiedCandidate[]> {
  if (candidates.length === 0) return []
  const { scores } = await generateJson<{ scores: { external_id: string; fit_score: number; reasoning: string }[] }>(
    QUALIFY_PROMPT,
    JSON.stringify(candidates.map((c) => ({ external_id: c.external_id, name: c.name, title: c.title, company: c.company, geography: c.geography })))
  )
  const scoreMap = new Map(scores.map((s) => [s.external_id, s]))
  return candidates
    .map((c) => {
      const s = scoreMap.get(c.external_id)
      return { ...c, fit_score: s?.fit_score ?? 0, reasoning: s?.reasoning ?? 'No score returned' }
    })
    .sort((a, b) => b.fit_score - a.fit_score)
}

async function alreadyKnown(externalIdsOrLinkedin: string[]): Promise<Set<string>> {
  if (externalIdsOrLinkedin.length === 0) return new Set()
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('gtm_prospects')
    .select('linkedin_url')
    .in('linkedin_url', externalIdsOrLinkedin)
  return new Set((data ?? []).map((r) => r.linkedin_url).filter(Boolean) as string[])
}

export interface ProspectingResult {
  regions_run: ProspectRegion[]
  discovered: number
  qualified: number
  enriched_with_email: number
  inserted: number
  skippedReason?: string
}

export async function runProspectingPipeline(qualifiedBudget: number): Promise<ProspectingResult> {
  if (!process.env.APOLLO_API_KEY) {
    return {
      regions_run: [], discovered: 0, qualified: 0, enriched_with_email: 0, inserted: 0,
      skippedReason: 'APOLLO_API_KEY not set — skipping rather than inventing prospects.',
    }
  }

  const regions = getProspectRegions()
  const { titles, keywords } = await getSearchTerms()
  const perRegionBudget = Math.max(1, Math.ceil(qualifiedBudget / regions.length))

  let totalDiscovered = 0
  let totalQualified = 0
  let totalEnriched = 0
  let totalInserted = 0
  const supabase = createServiceClient()

  for (const region of regions) {
    const raw = await apolloProvider.search({
      locations: REGION_LOCATIONS[region],
      titles,
      keywords,
      perPage: 10, // small on purpose — conserve free Apollo credits
    })
    totalDiscovered += raw.length
    if (raw.length === 0) continue

    const known = await alreadyKnown(raw.map((r) => r.linkedin_url).filter(Boolean) as string[])
    const fresh = raw.filter((r) => !r.linkedin_url || !known.has(r.linkedin_url))
    if (fresh.length === 0) continue

    const qualified = (await qualify(fresh)).filter((c) => c.fit_score >= 0.5).slice(0, perRegionBudget)
    totalQualified += qualified.length

    for (const candidate of qualified) {
      let email = candidate.email
      let emailConfidence = email ? 0.9 : 0
      if (!email && candidate.company_domain) {
        const [firstName, ...rest] = candidate.name.split(' ')
        const found = await hunterProvider.findEmail({
          firstName,
          lastName: rest.join(' ') || firstName,
          domain: candidate.company_domain,
        })
        email = found.email
        emailConfidence = found.confidence
        if (email) totalEnriched++
      }

      const row: Omit<Prospect, 'id' | 'created_at'> = {
        name: candidate.name,
        company: candidate.company,
        role: candidate.title,
        geography: candidate.geography ?? region,
        email,
        phone: null,
        linkedin_url: candidate.linkedin_url,
        linkedin_handle: null,
        instagram_handle: null,
        whatsapp: null,
        source: 'apollo_search',
        icp_hypothesis_id: null,
        fit_score: candidate.fit_score,
        trigger: null,
        pain_signal: null,
        status: 'new',
        last_contacted_at: null,
        next_action: 'Await qualification review / outreach draft',
        response: null,
        objection: null,
        notes: candidate.reasoning,
        provenance: `${candidate.provenance}:${region}`,
        confidence: Math.min(candidate.fit_score, emailConfidence || candidate.fit_score),
      }

      const { error } = await supabase.from('gtm_prospects').insert(row)
      // Unique-index violations (duplicate email/linkedin/whatsapp) are
      // expected and fine to skip silently; anything else, log it.
      if (error && error.code !== '23505') {
        console.error('[prospectingAgent] insert failed', error.message)
      } else if (!error) {
        totalInserted++
      }
    }
  }

  return {
    regions_run: regions,
    discovered: totalDiscovered,
    qualified: totalQualified,
    enriched_with_email: totalEnriched,
    inserted: totalInserted,
    skippedReason:
      totalDiscovered === 0
        ? 'Apollo returned 0 results across all regions — on the Free plan this almost always means the ' +
          'search API is plan-restricted, not that no one matched. Use the dashboard\u2019s CSV import instead.'
        : undefined,
  }
}
