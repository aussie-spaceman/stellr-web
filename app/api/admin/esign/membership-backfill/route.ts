import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { backfillMembershipAgreements } from '@/lib/membership-backfill'

// POST /api/admin/esign/membership-backfill — { dryRun?: boolean, limit?: number }
// Issues the Membership Agreement to existing members who have never signed
// one, a batch at a time. Dry run (the default) only counts.

export const maxDuration = 60

export async function POST(req: Request) {
  const { userId, sessionClaims } = await auth()
  if (!userId || !isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as { dryRun?: unknown; limit?: unknown }
  const dryRun = body.dryRun !== false
  const limit = Math.min(Math.max(1, Number(body.limit) || 25), 50)
  const result = await backfillMembershipAgreements(supabaseServer(), { dryRun, limit })
  if (!dryRun) console.info(`[membership-backfill] by ${userId}:`, JSON.stringify(result))
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
}
