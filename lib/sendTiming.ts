// lib/sendTiming.ts
// Picks a reasonable next business-hour slot for a cold email, so a day's
// worth of sends don't all land in one inbox-spam-looking burst at
// whatever minute the cron happened to run. Approximate on purpose — fixed
// UTC offsets, not real DST-aware timezone conversion — good enough for
// "roughly business hours", not a scheduling-precision guarantee.
//
// Resend only accepts scheduled_at up to 72 hours out — this always
// returns a time within that window.

const REGION_UTC_OFFSET_HOURS: Record<string, number> = {
  IN: 5.5, // IST
  US: -4, // ET (rough, ignores Pacific/Central and DST specifics)
  EU: 1, // CET (rough)
  AE: 4, // GST
}

function guessRegion(geography: string | null): string {
  if (!geography) return 'IN'
  const g = geography.toLowerCase()
  if (g.includes('india')) return 'IN'
  if (g.includes('emirates') || g.includes('dubai') || g.includes('abu dhabi')) return 'AE'
  if (g.includes('united states') || /\b(ny|ca|tx|il|ma)\b/.test(g)) return 'US'
  return 'EU'
}

/** Returns an ISO timestamp for the next weekday 9-11am local-ish time, within 72h. */
export function nextSendTime(geography: string | null): string {
  const region = guessRegion(geography)
  const offset = REGION_UTC_OFFSET_HOURS[region] ?? 0

  const now = new Date()
  const localHourNow = (now.getUTCHours() + offset + 24) % 24

  const candidate = new Date(now)
  // If it's already past the morning window locally, push to tomorrow.
  if (localHourNow >= 11) candidate.setUTCDate(candidate.getUTCDate() + 1)

  // Skip weekends (rough — treats Sat/Sun as non-send days everywhere).
  while ([0, 6].includes(candidate.getUTCDay())) {
    candidate.setUTCDate(candidate.getUTCDate() + 1)
  }

  // Set to ~9:30am local, expressed in UTC.
  const targetUtcHour = Math.floor((9.5 - offset + 24) % 24)
  candidate.setUTCHours(targetUtcHour, 30, 0, 0)

  // Clamp within Resend's 72h scheduling limit.
  const maxAhead = new Date(now.getTime() + 71 * 60 * 60 * 1000)
  const result = candidate.getTime() > maxAhead.getTime() ? maxAhead : candidate
  // Never schedule in the past (e.g. weekday math edge cases).
  const floor = new Date(now.getTime() + 5 * 60 * 1000)
  return (result.getTime() < floor.getTime() ? floor : result).toISOString()
}
