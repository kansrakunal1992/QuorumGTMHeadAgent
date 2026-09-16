// app/api/content-queue/[id]/route.ts
// PATCH, Bearer ADMIN_CODE. Body: { "state": "posted"|"rejected"|"skipped" }

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedAdmin } from '@/lib/adminAuth'
import { createServiceClient } from '@/lib/supabase'
import { recordFounderFeedback } from '@/lib/agents/learningAgent'
import type { ContentState } from '@/lib/types'

const VALID_STATES: ContentState[] = ['pending', 'posted', 'rejected', 'skipped']

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedAdmin(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json()
  const state = body.state as ContentState
  if (!VALID_STATES.includes(state)) {
    return NextResponse.json({ error: 'invalid state' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { error } = await supabase.from('gtm_content_queue').update({ state }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (state === 'rejected') {
    await recordFounderFeedback({ activity_id: id, label: 'bad', note: body.feedback_note })
  }

  return NextResponse.json({ ok: true })
}
