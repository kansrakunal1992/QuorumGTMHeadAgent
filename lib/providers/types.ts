// lib/providers/types.ts
// ── Prospect data provider interface ────────────────────────────────────
// Every lead-sourcing vendor (Apollo, Hunter, and whatever you add later —
// Cognism, PDL, Clay) implements this shape. prospectingAgent.ts only ever
// talks to these interfaces, never to a vendor SDK directly — swapping or
// adding a vendor means writing one new file here, not touching the agent.

export interface RawSearchResult {
  external_id: string // vendor's own id, for dedupe/traceability
  name: string
  title: string | null
  company: string | null
  company_domain: string | null
  geography: string | null
  linkedin_url: string | null
  email: string | null // usually null from search — filled in by an EmailFinder
  provenance: string // e.g. "apollo_search:US"
}

export interface ProspectSearchParams {
  locations: string[] // vendor-specific location strings, see apolloProvider's REGION_LOCATIONS
  titles: string[]
  keywords?: string[]
  perPage?: number
}

export interface ProspectSearchProvider {
  name: string
  search(params: ProspectSearchParams): Promise<RawSearchResult[]>
}

export interface EmailFinderProvider {
  name: string
  /** Attempts to find/verify a work email for a named person at a company domain. */
  findEmail(input: { firstName: string; lastName: string; domain: string }): Promise<{ email: string | null; confidence: number }>
}
