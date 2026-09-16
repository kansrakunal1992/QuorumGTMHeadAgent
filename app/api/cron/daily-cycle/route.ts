// app/api/cron/daily-cycle/route.ts
// POST, Bearer CRON_SECRET. Wire this up as a Railway Cron Job:
//   Schedule: 0 2 * * *   (02:00 UTC = 7:30 AM IST)
//   Command:  curl -s -X POST $RAILWAY_PUBLIC_DOMAIN/api/cron/daily-cycle \
//               -H "Authorization: Bearer $CRON_SECRET"

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/adminAuth'
import { runDailyCycle } from '@/lib/agents/gtmHead'

export async function POST(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const result = await runDailyCycle()
    return NextResponse.json(result)
  } catch (err) {
    console.error('[daily-cycle] failed', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
