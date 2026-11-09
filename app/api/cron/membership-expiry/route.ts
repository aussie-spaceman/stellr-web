import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { expireLapsedGrants } from '@/lib/membership-grants'
import { purgeUnconsentedAccounts, type PurgeResult } from '@/lib/pending-consent'
import { guardCron } from '@/lib/cron'
import { withCronAudit } from '@/lib/cron-audit'
import { startCronRun } from '@/lib/cron-runs'
import { sweepEventManagers, type SweepResult } from '@/lib/event-manager'

// GET /api/cron/membership-expiry — runs daily (see vercel.json). Three steps
// (the third, Event Manager expiry, is described where it runs below):
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

export const GET = withCronAudit('membership-expiry', async (req: NextRequest) => {
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

  // 3. Event Manager assignments: delete expired ones, and those whose holder's
  //    clearance has lapsed; clear the Clerk role with the last one (lib/event-manager).
  //    Readers already ignore expired rows, so this is clean-up plus the lapsed-
  //    clearance check, not the thing that ends access.
  let eventManagers: Omit<SweepResult, 'errors'> & { errors: number } | { error: string }
  try {
    const r = await sweepEventManagers(db)
    for (const e of r.errors) run.fail(`event-manager:${e.eventSlug}`, e.error)
    eventManagers = { ...r, errors: r.errors.length }
  } catch (err) {
    run.fail('event-manager', err)
    eventManagers = { error: err instanceof Error ? err.message : String(err) }
  }

  await run.finish({ expired, pendingConsentPurge: purge, eventManagers })
  if (expiryError) return NextResponse.json({ error: expiryError, pendingConsentPurge: purge, eventManagers }, { status: 500 })
  return NextResponse.json({ expired, pendingConsentPurge: purge, eventManagers })
})
