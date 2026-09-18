// lib/providers/resendProvider.ts
// ── Resend — EmailSenderProvider ─────────────────────────────────────────
// Uses your EXISTING Resend account/API key (the same one the main app
// uses for magic links/nudges) — no new service. `GTM_EMAIL_FROM` is a
// separate concern: it just needs to be an address on a domain already
// verified in that Resend account. See README for the "reuse now" vs
// "isolate later with a subdomain" tradeoff.

import 'server-only'

export interface SendEmailInput {
  to: string
  subject: string
  text: string
  replyTo?: string
  scheduledAt?: string // ISO timestamp, Resend supports up to 72h out
}

export interface SendEmailResult {
  ok: boolean
  id?: string
  error?: string
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.GTM_EMAIL_FROM
  if (!apiKey || !from) {
    return { ok: false, error: 'RESEND_API_KEY or GTM_EMAIL_FROM not set' }
  }

  const footer =
    process.env.GTM_EMAIL_FOOTER ||
    '\n\n---\nIf you\u2019d rather not hear from me again, just reply and let me know.'

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      text: input.text + footer,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      ...(input.scheduledAt ? { scheduled_at: input.scheduledAt } : {}),
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 300)}` }
  }

  const data = await res.json()
  return { ok: true, id: data.id }
}
