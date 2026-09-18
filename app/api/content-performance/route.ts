// app/api/content-performance/route.ts
// GET  — posted content items from the last 30 days, each with its latest
//        logged performance (if any), for the dashboard's Performance Log tab.
// POST — Bearer ADMIN_CODE. Body: { content_id, as_of_date?, impressions?,
//        engagement?, link_clicks?, notes? }. Upserts (one row per
//        content_id + as_of_date, so logging twice in a day updates, not
//        duplicates).

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedAdmin } from '@/lib/adminAuth'
import { createServiceClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  if (!isAuthorizedAdmin(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data: posted } = await supabase
    .from('gtm_content_queue')
    .select('id, channel, category, hook, body, created_at')
    .eq('state', 'posted')
    .gte('created_at', thirtyDaysAgo)
    .order('created_at', { ascending: false })

  const ids = (posted ?? []).map((p) => p.id)
  const { data: perf } = ids.length
    ? await supabase.from('gtm_content_performance').select('*').in('content_id', ids).order('as_of_date', { ascending: false })
    : { data: [] }

  const latestByContent = new Map<string, { as_of_date: string; impressions: number | null; engagement: number | null; link_clicks: number | null }>()
  for (const p of perf ?? []) {
    if (!latestByContent.has(p.content_id)) latestByContent.set(p.content_id, p)
  }

  const merged = (posted ?? []).map((p) => ({ ...p, latest_performance: latestByContent.get(p.id) ?? null }))
  return NextResponse.json({ items: merged })
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedAdmin(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  if (!body.content_id) {
    return NextResponse.json({ error: 'content_id required' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { error } = await supabase.from('gtm_content_performance').upsert(
    {
      content_id: body.content_id,
      as_of_date: body.as_of_date || new Date().toISOString().slice(0, 10),
      impressions: body.impressions ?? null,
      engagement: body.engagement ?? null,
      link_clicks: body.link_clicks ?? null,
      notes: body.notes ?? null,
    },
    { onConflict: 'content_id,as_of_date' }
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
