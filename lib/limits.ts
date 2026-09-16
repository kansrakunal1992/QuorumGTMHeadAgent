// lib/limits.ts
// ── Daily limit enforcement ────────────────────────────────────────────────
// Every autonomous action must pass through here first. Uses the
// gtm_increment_usage() Postgres function so the check-and-increment is one
// atomic round trip — no race where two parallel calls both read "9 of 10
// used" and both proceed.

import 'server-only'
import { createServiceClient } from './supabase'
import { getDailyLimits } from './config'
import type { DailyLimits } from './types'

export type UsageKey = keyof DailyLimits | 'total_actions'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Attempts to consume `amount` units of `key` for today. Returns whether it
 * was allowed. If allowed, the usage has already been recorded — callers
 * must not call this speculatively and skip the action after succeeding.
 */
export async function tryConsume(key: UsageKey, amount = 1): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limits = getDailyLimits()
  const limit = limits[key as keyof DailyLimits]
  const supabase = createServiceClient()
  const date = todayIso()

  // Peek first — cheap, avoids incrementing past the cap and then having to
  // decrement (decrementing isn't atomic-safe against a concurrent read).
  const { data: existing } = await supabase
    .from('gtm_daily_usage')
    .select('used_count')
    .eq('date', date)
    .eq('action_key', key)
    .maybeSingle()

  const currentUsed = existing?.used_count ?? 0
  if (currentUsed + amount > limit) {
    return { allowed: false, used: currentUsed, limit }
  }

  // Also enforce the master total-actions budget alongside the per-type cap,
  // unless this call *is* the total-actions accounting itself.
  if (key !== 'total_actions') {
    const totalCheck = await tryConsume('total_actions', amount)
    if (!totalCheck.allowed) {
      return { allowed: false, used: currentUsed, limit }
    }
  }

  // Known limitation: the total_actions counter above and this per-type
  // counter are two separate round trips, not one transaction. If this
  // second call fails after the first succeeded, total_actions can end up
  // slightly over-counted relative to the per-type counters. Low-stakes at
  // MVP volumes; if it matters later, fold both into one Postgres function
  // that increments both counters atomically in a single transaction.
  const { data: newCount, error } = await supabase.rpc('gtm_increment_usage', {
    p_date: date,
    p_action_key: key,
    p_amount: amount,
  })

  if (error) {
    // Fail closed: if we can't confirm the increment, don't let the action proceed.
    return { allowed: false, used: currentUsed, limit }
  }

  return { allowed: true, used: newCount as number, limit }
}

export async function getRemaining(key: UsageKey): Promise<{ used: number; limit: number; remaining: number }> {
  const limits = getDailyLimits()
  const limit = limits[key as keyof DailyLimits]
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('gtm_daily_usage')
    .select('used_count')
    .eq('date', todayIso())
    .eq('action_key', key)
    .maybeSingle()
  const used = data?.used_count ?? 0
  return { used, limit, remaining: Math.max(0, limit - used) }
}
