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
//   - WhatsApp: autonomous only if WHATSAPP_BUSINESS_TOKEN is set.
//   - Instagram: autonomous only if INSTAGRAM_GRAPH_TOKEN is set.
//   - Email: Founder Action by default even if RESEND_API_KEY exists,
//     unless GTM_EMAIL_AUTONOMOUS=true is explicitly set — cold outreach
//     sent autonomously from the same domain/account used for the product's
//     transactional email (magic links, nudges) risks that domain's
//     deliverability. Flip this on deliberately once a separate sending
//     domain/reputation is in place.

import 'server-only'
import { createServiceClient } from '../supabase'
import { generateJson } from '../ai-client'
import { getConnectedChannels, QUORUM_BOOKING_URL, QUORUM_FREE_SESSION_URL } from '../config'
import type { Prospect, Channel } from '../types'

const SYSTEM_PROMPT = `You are the Outreach Agent for Quorum's GTM Head.

Quorum is a "judgment compounding system" for founders/CXOs/family office
principals facing high-stakes decisions — not a chatbot. Draft ONE outreach
message for the given prospect and channel. Requirements:
- Start a relevant conversation. Do not aggressively sell.
- No manipulative language. No fabricated personal knowledge about the
  prospect beyond what's given in their record.
- Smallest possible next step. There are two real, live, founder-led CTAs —
  pick the one that fits a COLD first touch to a stranger:
  1. FREE 30-min session (default for cold/first-touch): ${QUORUM_FREE_SESSION_URL}
     — no payment, lower trust barrier, the right ask for someone who has
     never heard of Quorum before.
  2. Paid ₹299 Decision Session: ${QUORUM_BOOKING_URL} — only offer this
     instead of the free one if the prospect record shows they're already
     warm (a reply, a referral, prior engagement) — asking a total stranger
     for money in a first cold email is a bigger, colder ask than it needs
     to be.
  It's also fine to have NO link at all and just ask a genuine question —
  not every message needs a CTA baked in on the first touch.
Return ONLY JSON: { "message": string, "why_this_person": string,
"why_this_message": string, "recommended_timing": string,
"expected_objective": string }`

interface OutreachDraft {
  message: string
  why_this_person: string
  why_this_message: string
  recommended_timing: string
  expected_objective: string
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
  if (channel === 'email') return connected.email && process.env.GTM_EMAIL_AUTONOMOUS === 'true'
  if (channel === 'whatsapp') return connected.whatsapp
  if (channel === 'instagram') return connected.instagram
  return false
}

/**
 * Queues outreach for a prospect. Returns 'founder_action' or 'autonomous'
 * so the caller (gtmHead orchestrator) knows which usage-limit bucket and
 * activity-log autonomy_level to record.
 */
export async function queueOutreach(
  prospect: Prospect,
  channel: Exclude<Channel, 'internal'>
): Promise<{ mode: 'founder_action' | 'autonomous'; id: string } | null> {
  const destination = destinationFor(prospect, channel)
  if (!destination) return null

  const draft = await draftOutreach(prospect, channel)
  const supabase = createServiceClient()
  const autonomous = isAutonomousChannel(channel)

  if (!autonomous) {
    const { data, error } = await supabase
      .from('gtm_founder_actions')
      .insert({
        channel,
        target_name: prospect.name,
        target_destination: destination,
        exact_message: draft.message,
        why_this_person: draft.why_this_person,
        why_this_message: draft.why_this_message,
        recommended_timing: draft.recommended_timing,
        expected_objective: draft.expected_objective,
        prospect_id: prospect.id,
      })
      .select('id')
      .single()
    if (error) throw error
    return { mode: 'founder_action', id: data.id }
  }

  // Autonomous send path is intentionally NOT implemented here — wire the
  // actual WhatsApp Business / Instagram Graph API call in once those
  // credentials exist, then log to gtm_activity_log with status 'done'.
  // Until then, even a "connected" channel falls back to a Founder Action
  // so nothing is silently dropped.
  const { data, error } = await supabase
    .from('gtm_founder_actions')
    .insert({
      channel,
      target_name: prospect.name,
      target_destination: destination,
      exact_message: draft.message,
      why_this_person: draft.why_this_person,
      why_this_message: draft.why_this_message,
      recommended_timing: draft.recommended_timing,
      expected_objective: draft.expected_objective,
      prospect_id: prospect.id,
    })
    .select('id')
    .single()
  if (error) throw error
  return { mode: 'founder_action', id: data.id }
}
