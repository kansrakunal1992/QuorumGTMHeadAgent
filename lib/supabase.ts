// lib/supabase.ts
// ── Supabase service client ───────────────────────────────────────────────
//
// Deliberately points at the SAME Supabase project as the main Quorum app
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY below are the same values you'd
// find in the main app's Railway variables — copy them across, don't create
// a new Supabase project).
//
// This client is used for two very different things:
//   1. READ-ONLY access to the main app's own tables (sessions, mirror_access,
//      decision_session_payments, referrals, auth.users) to compute real
//      funnel numbers. The GTM Head must never write to these.
//   2. Full read/write access to the new gtm_* tables created by
//      supabase/gtm_schema.sql — this agent owns those tables completely.
//
// Service-role key bypasses RLS, so this must only ever be used server-side
// (cron routes, API routes) — never exposed to a browser bundle.
// ─────────────────────────────────────────────────────────────────────────

import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

export function createServiceClient(): SupabaseClient {
  if (cached) return cached

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. These must be the ' +
        'SAME values as the main Quorum app\u2019s Railway variables — this ' +
        'project reuses that Supabase project, it does not get its own.'
    )
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}
