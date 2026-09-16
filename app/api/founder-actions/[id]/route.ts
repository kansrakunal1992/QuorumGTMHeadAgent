// app/api/founder-actions/[id]/route.ts
// PATCH, Bearer ADMIN_CODE. Body: { "state": "sent"|"rejected"|"snoozed"|
// "wrong_target"|"not_relevant"|"blocked_type"|"done", "feedback_note"?: string }

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedAdmin } from '@/lib/adminAuth'
import { createServiceClient } from '@/lib/supabase'
import { recordFounderFeedback } from '@/lib/agents/learningAgent'
import type { FounderActionState } from '@/lib/types'

const VALID_STATES: FounderActionState[] = [
  'pending', 'sent', 'rejected', 'snoozed', 'edited',
  'wrong_target', 'not_relevant', 'blocked_type', 'done',
]

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedAdmin(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json()
  const state = body.state as FounderActionState
  if (!VALID_STATES.includes(state)) {
    return NextResponse.json({ error: 'invalid state' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { error } = await supabase.from('gtm_founder_actions').update({ state }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const feedbackMap: Partial<Record<FounderActionState, Parameters<typeof recordFounderFeedback>[0]['label']>> = {
    rejected: 'bad',
    not_relevant: 'wrong_icp',
    wrong_target: 'wrong_icp',
    blocked_type: 'never_again',
    sent: 'good',
  }
  const label = feedbackMap[state]
  if (label) {
    await recordFounderFeedback({ founder_action_id: id, label, note: body.feedback_note })
  }

  return NextResponse.json({ ok: true })
}
