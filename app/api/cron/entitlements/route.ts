import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { runEntitlementsLifecycle } from '@/lib/entitlements'
import { guardCron } from '@/lib/cron'
import { startCronRun } from '@/lib/cron-runs'
import { sendDailyErrorDigest } from '@/lib/app-errors'
import { gcRateLimitStore } from '@/lib/rate-limit-store'

// GET /api/cron/entitlements — runs daily (see vercel.json).
// Re-grants per-period tier allowances (e.g. the quarterly free mentoring
// cohort) into the entitlements ledger, and expires granted lots whose
// membership has lapsed. Idempotent: a no-op until a new period opens or a
// membership lapses. Purchased entitlements are never touched.
//
// S1 monitoring: this daily run also sends the "Errors in the last day" email
// (lib/app-errors.ts) rather than adding a cron of its own. It runs whether or
// not the lifecycle succeeded, records itself in cron_runs as 'error-digest',
// and never throws, so neither job can take the other down.
//
// S5 B4: it also clears expired rate limit windows, once RATE_LIMIT_STORE is not
// memory. In memory mode that step makes no call, and the response is unchanged.
export async function GET(req: NextRequest) {
  const blocked = guardCron(req)
  if (blocked) return blocked
  // deep review INT-9: record the run in cron_runs so a silently-failing
  // entitlements lifecycle (grants/expiries stopping for weeks) is detectable.
  const db = supabaseServer()
  const run = await startCronRun(db, 'entitlements')
  try {
    const result = await runEntitlementsLifecycle()
    await run.finish(result as Record<string, unknown>)
    const errorDigest = await sendDailyErrorDigest(db)
    const rateLimitGc = await gcRateLimitStore(db)
    return NextResponse.json({ ...result, errorDigest, ...(rateLimitGc ? { rateLimitGc } : {}) })
  } catch (err) {
    console.error('[cron/entitlements]:', err)
    run.fail('run', err)
    await run.finish({})
    const errorDigest = await sendDailyErrorDigest(db)
    const rateLimitGc = await gcRateLimitStore(db)
    return NextResponse.json({ error: 'lifecycle failed', errorDigest, ...(rateLimitGc ? { rateLimitGc } : {}) }, { status: 500 })
  }
}
