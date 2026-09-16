// lib/config.ts
// ── All operator-tunable settings, read from Railway environment variables ──
//
// Per the founder's instruction: nothing is hardcoded here that should be a
// dial. Every value below has a safe default (matching the GTM spec's
// suggested defaults) but is fully overridable by setting the env var in
// Railway — no redeploy of logic required, just a variable change + restart.

import 'server-only'
import type { AutonomyMode, DailyLimits } from './types'

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  const parsed = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export function getAutonomyMode(): AutonomyMode {
  const raw = (process.env.GTM_AUTONOMY_MODE ?? 'full').toLowerCase()
  if (raw === 'full' || raw === 'conservative' || raw === 'research_only') return raw
  return 'full'
}

export function getDailyLimits(): DailyLimits {
  return {
    total_actions: envInt('GTM_LIMIT_TOTAL_ACTIONS', 100),
    prospects_researched: envInt('GTM_LIMIT_PROSPECTS_RESEARCHED', 50),
    // Of the prospects discovered/researched above, how many may be kept
    // after LLM qualification (and therefore enriched + queued for
    // outreach). Deliberately small — the scarce resource is learning
    // signal, not lead volume. Split roughly evenly across PROSPECT_REGIONS.
    prospects_qualified: envInt('GTM_LIMIT_PROSPECTS_QUALIFIED_PER_DAY', 20),
    outreach_messages: envInt('GTM_LIMIT_OUTREACH_MESSAGES', 15),
    follow_ups: envInt('GTM_LIMIT_FOLLOW_UPS', 10),
    linkedin_comments: envInt('GTM_LIMIT_LINKEDIN_COMMENTS', 20),
    linkedin_posts: envInt('GTM_LIMIT_LINKEDIN_POSTS', 2),
    instagram_posts: envInt('GTM_LIMIT_INSTAGRAM_POSTS', 1),
    whatsapp_outreach: envInt('GTM_LIMIT_WHATSAPP_OUTREACH', 10),
    whatsapp_status: envInt('GTM_LIMIT_WHATSAPP_STATUS', 1),
    email_outreach: envInt('GTM_LIMIT_EMAIL_OUTREACH', 15),
    experiments: envInt('GTM_LIMIT_EXPERIMENTS', 2),
    competitor_research: envInt('GTM_LIMIT_COMPETITOR_RESEARCH', 5),
  }
}

// Regions to prospect in, in order. Apollo location filters are built from
// this in lib/providers/apolloProvider.ts (see REGION_LOCATIONS there).
export function getProspectRegions(): import('./types').ProspectRegion[] {
  const raw = (process.env.PROSPECT_REGIONS ?? 'IN,US,EU,AE').toUpperCase()
  const valid = new Set(['IN', 'US', 'EU', 'AE'])
  const regions = raw.split(',').map((r) => r.trim()).filter((r) => valid.has(r))
  return (regions.length > 0 ? regions : ['IN', 'US', 'EU', 'AE']) as import('./types').ProspectRegion[]
}

export function getDailySpendCapInr(): number {
  return envInt('GTM_DAILY_SPEND_CAP_INR', 0) // 0 = no autonomous ad spend authority
}

// Channels with a real, official, compliant send/publish API connected.
// Everything else automatically becomes a Level-C Founder Action regardless
// of autonomy mode or remaining caps — this project never scrapes or
// browser-automates a platform (per the founder's own product principle).
export function getConnectedChannels() {
  return {
    linkedin: false, // no compliant personal-profile send/publish API exists — always Founder Action
    whatsapp: Boolean(process.env.WHATSAPP_BUSINESS_TOKEN),
    email: Boolean(process.env.RESEND_API_KEY),
    instagram: Boolean(process.env.INSTAGRAM_GRAPH_TOKEN),
  }
}

export const QUORUM_SITE_URL = process.env.QUORUM_MARKETING_URL || 'https://quorumvault.org'
export const QUORUM_APP_URL = process.env.QUORUM_APP_URL || 'https://app.quorumvault.org'
