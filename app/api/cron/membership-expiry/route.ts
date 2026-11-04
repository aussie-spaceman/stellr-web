import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { expireLapsedGrants } from '@/lib/membership-grants'
import { purgeUnconsentedAccounts, type PurgeResult } from '@/lib/pending-consent'
import { guardCron } from '@/lib/cron'
import { startCronRun } from '@/lib/cron-runs'

// GET /api/cron/membership-expiry — runs daily (see vercel.json). Two steps:
//
//   1. Flips complimentary / rule-granted memberships to 'expired' once their
//      expires_at has passed (the downgrade side of the grant engine). Paid
//      Stripe memberships are excluded — those are governed by the Stripe
//      webhook. Idempotent: rows are only updated while still 'active'.
//   2. Purges self-registered minors whose parent or guardian has not
//      consented within 30 days (decision 24, lib/pending-consent). Chained
//      here rather than given its own schedule: Vercel Hobby limits crons.
//      Independent of step 1, so a failure in one never skips the other.

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const blocked = guardCron(req)
  if (blocked) return blocked

  // deep review INT-9: record the run so a failing downgrade engine is visible.
  const db = supabaseServer()
  const run = await startCronRun(db, 'membership-expiry')

  let expired: unknown = null
  let expiryError: string | null = null
  try {
    expired = await expireLapsedGrants()
  } catch (err) {
    run.fail('run', err)
    expiryError = String(err)
  }

  let purge: Omit<PurgeResult, 'errors'> & { errors: number } | { error: string }
  try {
    const r = await purgeUnconsentedAccounts(db)
    for (const e of r.errors) run.fail(`pending-consent:${e.memberId}`, e.error)
    purge = { ...r, errors: r.errors.length }
  } catch (err) {
    run.fail('pending-consent', err)
    purge = { error: err instanceof Error ? err.message : String(err) }
  }

  await run.finish({ expired, pendingConsentPurge: purge })
  if (expiryError) return NextResponse.json({ error: expiryError, pendingConsentPurge: purge }, { status: 500 })
  return NextResponse.json({ expired, pendingConsentPurge: purge })
}
