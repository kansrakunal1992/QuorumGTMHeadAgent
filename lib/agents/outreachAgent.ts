// lib/agents/outreachAgent.ts
// ── Prospecting + Outreach + Social Engagement Agent ──────────────────────
//
// Drafts personalized outreach for a prospect. Every draft must answer the
// spec's five questions (why this person / why now / why Quorum / why this
// message / smallest next step) and must never fabricate a personalization
// claim that isn't backed by something on the prospect's record.
//
// Routing to autonomous-send vs Founder Action:
//   - LinkedIn: ALWAYS Founder Action. There is no compliant official API
//     for personal-profile DMs/posts/comments — this project does not
//     scrape or browser-automate, per the founder's own product principle.
//   - WhatsApp: autonomous only if WHATSAPP_BUSINESS_TOKEN is set (send
//     call not implemented yet — falls back to Founder Action honestly).
//   - Instagram: same as WhatsApp — token-gated, not yet implemented.
//   - Email: ACTUALLY SENT via Resend when GTM_EMAIL_AUTONOMOUS=true and
//     both RESEND_API_KEY and GTM_EMAIL_FROM are set. Scheduled a few hours
//     out to a rough regional business-hour slot (lib/sendTiming.ts) rather
//     than fired the instant the cron runs, so a day's sends don't look
//     like a single burst. Falls back to a Founder Action if the send fails
//     for any reason — nothing is silently dropped.

import 'server-only'
import { createServiceClient } from '../supabase'
import { generateJson } from '../ai-client'
import { getConnectedChannels, QUORUM_BOOKING_URL, QUORUM_FREE_SESSION_URL } from '../config'
import { sendEmail } from '../providers/resendProvider'
import { nextSendTime } from '../sendTiming'
import type { Prospect, Channel } from '../types'

const SYSTEM_PROMPT = `You are the Outreach Agent for Quorum's GTM Head.

Quorum is a "judgment compounding system" for founders/CXOs/family office
principals facing high-stakes decisions — not a chatbot. Draft ONE outreach
message for the given prospect and channel. Requirements:
- Start a relevant conversation. Do not aggressively sell.
- No manipulative language. No fabricated personal knowledge about the
  prospect beyond what's given in their record.
- The message MUST include exactly one CTA, so it's possible to measure
  whether outreach is actually converting. Pick whichever of these two real,
  live, founder-led sessions fits a COLD first touch to a stranger:
  - "free_session" (default for cold/first-touch) — no payment, lower trust
    barrier, the right ask for someone who has never heard of Quorum before.
  - "paid_session" — only pick this instead if the prospect record shows
    they're already warm (a reply, a referral, prior engagement) — asking a
    stranger for money on a first cold email is a bigger ask than it needs
    to be.
  Write the link's placement into the message body as the literal token
  {{CTA_LINK}} at the exact point the URL should appear (e.g. "...you can
  grab a slot here: {{CTA_LINK}}") — the real URL is substituted afterward,
  don't invent your own URL text.
- If channel is "email", also write a short, plain subject line — no ALL
  CAPS, no exclamation marks, nothing that reads as a spam trigger. For
  other channels, subject should be null.
Return ONLY JSON: { "message": string, "subject": string|null,
"cta_type": "free_session"|"paid_session", "why_this_person": string,
"why_this_message": string, "recommended_timing": string,
"expected_objective": string }`

interface OutreachDraft {
  message: string
  subject: string | null
  cta_type: 'free_session' | 'paid_session'
  why_this_person: string
  why_this_message: string
  recommended_timing: string
  expected_objective: string
}

/** Adds UTM + a per-prospect id so link clicks/bookings can (eventually) be attributed back to this outreach. */
function trackedCtaUrl(ctaType: OutreachDraft['cta_type'], prospect: Prospect, channel: Channel): string {
  const base = ctaType === 'paid_session' ? QUORUM_BOOKING_URL : QUORUM_FREE_SESSION_URL
  const url = new URL(base)
  url.searchParams.set('utm_source', 'gtm_head')
  url.searchParams.set('utm_medium', channel)
  url.searchParams.set('utm_campaign', 'cold_outreach')
  url.searchParams.set('pid', prospect.id)
  return url.toString()
}

/** Guarantees the CTA is actually present even if the model forgot the placeholder. */
function applyCta(message: string, ctaUrl: string): string {
  if (message.includes('{{CTA_LINK}}')) return message.replaceAll('{{CTA_LINK}}', ctaUrl)
  return `${message}\n\n${ctaUrl}`
}

export async function draftOutreach(prospect: Prospect, channel: Channel): Promise<OutreachDraft> {
  return generateJson<OutreachDraft>(SYSTEM_PROMPT, JSON.stringify({ prospect, channel }))
}

function destinationFor(prospect: Prospect, channel: Channel): string | null {
  switch (channel) {
    case 'linkedin':
      return prospect.linkedin_url || prospect.linkedin_handle
    case 'whatsapp':
      return prospect.whatsapp
    case 'email':
      return prospect.email
    case 'instagram':
      return prospect.instagram_handle
    default:
      return null
  }
}

function isAutonomousChannel(channel: Channel): boolean {
  const connected = getConnectedChannels()
  if (channel === 'linkedin') return false
  if (channel === 'email') {
    return connected.email && process.env.GTM_EMAIL_AUTONOMOUS === 'true' && Boolean(process.env.GTM_EMAIL_FROM)
  }
  if (channel === 'whatsapp') return connected.whatsapp
  if (channel === 'instagram') return connected.instagram
  return false
}

async function insertFounderAction(
  prospect: Prospect,
  channel: Channel,
  destination: string,
  draft: OutreachDraft,
  state: 'pending' | 'sent' = 'pending'
): Promise<string> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('gtm_founder_actions')
    .insert({
      channel,
      target_name: prospect.name,
      target_destination: destination,
      exact_message: draft.message,
      subject: draft.subject,
      why_this_person: draft.why_this_person,
      why_this_message: draft.why_this_message,
      recommended_timing: draft.recommended_timing,
      expected_objective: draft.expected_objective,
      prospect_id: prospect.id,
      state,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export interface QueueOutreachResult {
  mode: 'founder_action' | 'autonomous_sent' | 'autonomous_failed'
  id: string
  scheduledAt?: string
  error?: string
}

/**
 * Queues (or, for email with autonomy on, actually sends) outreach for a
 * prospect. Caller (gtmHead) uses `mode` to decide usage-limit bucket and
 * activity-log autonomy_level.
 */
export async function queueOutreach(
  prospect: Prospect,
  channel: Exclude<Channel, 'internal'>
): Promise<QueueOutreachResult | null> {
  const destination = destinationFor(prospect, channel)
  if (!destination) return null

  const draft = await draftOutreach(prospect, channel)
  // Substitute the real, tracked CTA URL — never trust the model to have
  // written (or correctly formatted) it itself.
  draft.message = applyCta(draft.message, trackedCtaUrl(draft.cta_type, prospect, channel))
  const autonomous = isAutonomousChannel(channel)

  if (!autonomous) {
    const id = await insertFounderAction(prospect, channel, destination, draft, 'pending')
    return { mode: 'founder_action', id }
  }

  if (channel === 'email') {
    const scheduledAt = nextSendTime(prospect.geography)
    const result = await sendEmail({
      to: destination,
      subject: draft.subject || `Quorum — a question for ${prospect.name.split(' ')[0]}`,
      text: draft.message,
      replyTo: process.env.GTM_EMAIL_REPLY_TO || undefined,
      scheduledAt,
    })

    if (result.ok) {
      const id = await insertFounderAction(prospect, channel, destination, draft, 'sent')
      return { mode: 'autonomous_sent', id, scheduledAt }
    }

    // Send failed — don't lose the draft, fall back to a Founder Action.
    const id = await insertFounderAction(prospect, channel, destination, draft, 'pending')
    return { mode: 'autonomous_failed', id, error: result.error }
  }

  // WhatsApp/Instagram: token-gated but the actual send call isn't wired
  // yet — honest fallback rather than a fake "sent".
  const id = await insertFounderAction(prospect, channel, destination, draft, 'pending')
  return { mode: 'founder_action', id }
}
