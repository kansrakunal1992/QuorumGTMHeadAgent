// lib/providers/googleCalendarProvider.ts
// ── Google Calendar — free session (/kunal_elite) booking reads ─────────
//
// Uses a service-account JWT (no browser OAuth consent flow, no refresh
// tokens to manage) — this is the standard server-to-server pattern for a
// calendar the founder can just share once. Implemented with Node's built-in
// `crypto` module rather than adding the `googleapis` SDK, consistent with
// this project's other providers (Apollo/Hunter/Resend are all raw fetch).
//
// LIMITATION, stated plainly: the /kunal_elite booking widget (a Google
// Calendar "Appointment Schedule") has no custom URL-param passthrough —
// clicking a tracked link does NOT tag the resulting calendar event with
// utm_source/content the way the ₹299 flow does. Matching here is done by
// EMAIL ADDRESS (the attendee email Google captures at booking time)
// against gtm_prospects.email / a nurtured user's real email — solid, but
// not the same param-level certainty as the paid flow.
//
// Setup: see README §2c/§A. Three env vars: GOOGLE_SERVICE_ACCOUNT_EMAIL,
// GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, GOOGLE_CALENDAR_ID_KUNAL_ELITE. All
// three unset (or the calendar not yet shared with the service account) →
// this returns [] — a documented no-op, not a crash.

import 'server-only'
import { createSign } from 'crypto'

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function normalizePrivateKey(raw: string): string {
  // Railway env vars are single-line — the JSON's `\n` escape sequences
  // come through as the literal two characters backslash-n, not a real
  // newline. Convert them back. If someone already pasted real newlines
  // (some editors do this), this is a harmless no-op.
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw
}

async function getAccessToken(): Promise<string | null> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  if (!email || !rawKey) return null

  const privateKey = normalizePrivateKey(rawKey)
  const now = Math.floor(Date.now() / 1000)

  const header = { alg: 'RS256', typ: 'JWT' }
  const claimSet = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`

  let signature: Buffer
  try {
    signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey)
  } catch (err) {
    console.error('[googleCalendarProvider] failed to sign JWT — check GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY formatting', err)
    return null
  }
  const jwt = `${unsigned}.${base64url(signature)}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  if (!res.ok) {
    console.error('[googleCalendarProvider] token exchange failed', res.status, await res.text().catch(() => ''))
    return null
  }
  const data = await res.json()
  return data.access_token ?? null
}

export interface CalendarBooking {
  eventId: string
  attendeeEmails: string[]
  createdAt: string
  startTime: string | null
}

/** Bookings created/updated since `sinceIso`. Returns [] on any missing config or auth/API failure — never throws. */
export async function listRecentBookings(sinceIso: string): Promise<CalendarBooking[]> {
  const calendarId = process.env.GOOGLE_CALENDAR_ID_KUNAL_ELITE
  if (!calendarId) return []

  const accessToken = await getAccessToken()
  if (!accessToken) return []

  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`)
  url.searchParams.set('updatedMin', sinceIso)
  url.searchParams.set('singleEvents', 'true')
  url.searchParams.set('orderBy', 'updated')
  url.searchParams.set('maxResults', '50')

  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) {
    console.error('[googleCalendarProvider] events.list failed', res.status, await res.text().catch(() => ''))
    return []
  }

  const data = await res.json()
  const items: Array<{
    id: string
    created?: string
    updated?: string
    start?: { dateTime?: string; date?: string }
    attendees?: Array<{ email?: string }>
  }> = data.items ?? []

  return items.map((e) => ({
    eventId: e.id,
    attendeeEmails: (e.attendees ?? []).map((a) => a.email).filter((x): x is string => Boolean(x)),
    createdAt: e.created ?? e.updated ?? new Date().toISOString(),
    startTime: e.start?.dateTime ?? e.start?.date ?? null,
  }))
}
