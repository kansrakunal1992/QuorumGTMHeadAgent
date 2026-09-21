// lib/shortLink.ts
// ── Clean redirect links for outreach/nurture ────────────────────────────
// A raw link like quorumvault.org/kunal_elite?utm_source=gtm_head&utm_
// campaign=cold_outreach_email visibly tells the recipient "this is
// automated" before they've even clicked — hurts reply rates. This writes
// a row the website's GET /go/:code route (server.js, website-patch)
// resolves server-side, so the visible link is just
// quorumvault.org/go/aB3xK9 — clean, on your own trusted domain, still
// fully tracked underneath.

import 'server-only'
import { randomBytes } from 'crypto'
import { createServiceClient } from './supabase'
import { QUORUM_SITE_URL } from './config'

/** Creates a short link and returns the clean, recipient-facing URL. Falls back to the raw tracked URL if the insert fails, so a DB hiccup never blocks a send. */
export async function createShortLink(destinationUrl: string, card: 'kunal' | 'kunal_elite'): Promise<string> {
  const code = randomBytes(5).toString('base64url') // ~7 url-safe chars, e.g. "aB3xK9Q"
  const supabase = createServiceClient()

  const { error } = await supabase.from('gtm_short_links').insert({
    code,
    destination_url: destinationUrl,
    card,
  })

  if (error) {
    console.error('[shortLink] insert failed, falling back to raw tracked URL', error.message)
    return destinationUrl
  }

  return `${QUORUM_SITE_URL}/go/${code}`
}
