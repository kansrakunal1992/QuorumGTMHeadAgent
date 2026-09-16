// lib/adminAuth.ts
import 'server-only'
import type { NextRequest } from 'next/server'

export function isAuthorizedAdmin(req: NextRequest): boolean {
  const header = req.headers.get('authorization') ?? ''
  const token = header.replace(/^Bearer\s+/i, '')
  const expected = process.env.ADMIN_CODE
  return Boolean(expected) && token === expected
}

export function isAuthorizedCron(req: NextRequest): boolean {
  const header = req.headers.get('authorization') ?? ''
  const token = header.replace(/^Bearer\s+/i, '')
  const expected = process.env.CRON_SECRET
  return Boolean(expected) && token === expected
}
