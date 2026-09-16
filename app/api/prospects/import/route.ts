// app/api/prospects/import/route.ts
// POST, Bearer ADMIN_CODE. Body: { csv: string }
//
// Workaround for Apollo's People Search API being paid-plan-only: the
// founder runs the search in Apollo's web UI (free), exports/copies the
// results as CSV, and pastes them here. Everything downstream — LLM
// qualification isn't re-run (the founder's own search filters already did
// that), Hunter enrichment, outreach drafting, learning — proceeds exactly
// as if prospectingAgent had found them, because it's the same table.

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedAdmin } from '@/lib/adminAuth'
import { createServiceClient } from '@/lib/supabase'
import { parseCsv, mapCsvRowToProspect } from '@/lib/csv'

const MANUAL_IMPORT_FIT_SCORE = 0.6 // founder already pre-filtered via search criteria

export async function POST(req: NextRequest) {
  if (!isAuthorizedAdmin(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { csv } = await req.json()
  if (typeof csv !== 'string' || !csv.trim()) {
    return NextResponse.json({ error: 'missing csv text' }, { status: 400 })
  }

  const rows = parseCsv(csv)
  const supabase = createServiceClient()
  let inserted = 0
  let skipped = 0

  for (const row of rows) {
    const mapped = mapCsvRowToProspect(row)
    if (!mapped) { skipped++; continue }

    const { error } = await supabase.from('gtm_prospects').insert({
      name: mapped.name,
      company: mapped.company,
      role: mapped.role,
      geography: mapped.geography,
      email: mapped.email,
      phone: null,
      linkedin_url: mapped.linkedin_url,
      linkedin_handle: null,
      instagram_handle: null,
      whatsapp: null,
      source: 'apollo_manual_export',
      fit_score: MANUAL_IMPORT_FIT_SCORE,
      status: 'new',
      next_action: 'Await outreach draft',
      provenance: 'apollo_ui_export (manual, Free plan)',
      confidence: 0.6,
    })

    // Unique-index violation (duplicate email/linkedin) is expected — skip quietly.
    if (error && error.code !== '23505') {
      console.error('[prospects/import] insert failed', error.message)
      skipped++
    } else if (!error) {
      inserted++
    } else {
      skipped++
    }
  }

  return NextResponse.json({ parsed: rows.length, inserted, skipped })
}
