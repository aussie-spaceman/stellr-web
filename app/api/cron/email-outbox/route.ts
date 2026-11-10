import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { guardCron } from '@/lib/cron'
import { withCronAudit } from '@/lib/cron-audit'
import { startCronRun } from '@/lib/cron-runs'
import { drainEmailOutbox, STALE_WAIT_MS } from '@/lib/email/outbox'

// GET /api/cron/email-outbox — sends the mail Resend could not take when it was
// first sent (the daily or monthly quota, the rate limit, an outage), which
// sendEmail parked in the email outbox (lib/email/outbox.ts). Transactional
// mail first, oldest first, until Resend refuses again; the rest waits for the
// next run.
//
// Four daily slots (vercel.json): 00:05 UTC, just after the new UTC day starts,
// then 06:05, 12:05 and 18:05, so mail held back by the daily quota goes out
// within hours of the quota resetting, whenever in the day that is.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Stop starting new sends once this much of the function's time is gone. */
const SEND_BUDGET_MS = 45_000

export const GET = withCronAudit('email-outbox', async (req: NextRequest) => {
  const blocked = guardCron(req)
  if (blocked) return blocked

  const db = supabaseServer()
  const run = await startCronRun(db, 'email-outbox')
  try {
    const result = await drainEmailOutbox(db, { deadline: Date.now() + SEND_BUDGET_MS })
    // Mail that has waited two days means Resend has refused it for two days
    // running (the monthly quota, a revoked key, an unverified domain). Mark the
    // run failed so it shows wherever cron_runs failures show.
    if (result.oldestWaitingHours != null && result.oldestWaitingHours * 3_600_000 > STALE_WAIT_MS) {
      run.fail('stale', `${result.waiting} email(s) waiting; the oldest for ${result.oldestWaitingHours}h`)
    }
    if (result.failed) run.fail('rejected', `${result.failed} email(s) rejected by Resend as invalid`)
    await run.finish({ ...result })
    return NextResponse.json(result)
  } catch (err) {
    run.fail('drain', err)
    await run.finish({})
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
})
