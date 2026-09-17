// app/api/dashboard/route.ts
// GET, Bearer ADMIN_CODE. Backs the founder dashboard UI at app/page.tsx.

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedAdmin } from '@/lib/adminAuth'
import { createServiceClient } from '@/lib/supabase'
import { getDailyLimits, getAutonomyMode } from '@/lib/config'

export async function GET(req: NextRequest) {
  if (!isAuthorizedAdmin(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const today = new Date().toISOString().slice(0, 10)

  const [{ data: plan }, { data: report }, { data: activity }, { data: founderActions }, { data: contentQueue }, { data: productRecs }, { data: usage }] =
    await Promise.all([
      supabase.from('gtm_daily_plans').select('*').eq('date', today).maybeSingle(),
      supabase.from('gtm_daily_reports').select('*').eq('date', today).maybeSingle(),
      supabase.from('gtm_activity_log').select('*').gte('timestamp', `${today}T00:00:00Z`).order('timestamp', { ascending: false }),
      supabase.from('gtm_founder_actions').select('*').eq('state', 'pending').order('created_at', { ascending: false }),
      supabase.from('gtm_content_queue').select('*').eq('state', 'pending').order('created_at', { ascending: false }),
      supabase.from('gtm_product_recommendations').select('*').eq('state', 'pending').order('created_at', { ascending: false }),
      supabase.from('gtm_daily_usage').select('*').eq('date', today),
    ])

  return NextResponse.json({
    date: today,
    autonomy_mode: getAutonomyMode(),
    daily_limits: getDailyLimits(),
    usage: usage ?? [],
    plan: plan ?? null,
    report: report ?? null,
    activity: activity ?? [],
    founder_actions_pending: founderActions ?? [],
    content_queue_pending: contentQueue ?? [],
    product_recommendations_pending: productRecs ?? [],
  })
}
