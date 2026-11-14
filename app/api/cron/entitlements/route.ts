import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { runEntitlementsLifecycle } from '@/lib/entitlements'
import { guardCron } from '@/lib/cron'
import { withCronAudit } from '@/lib/cron-audit'
import { startCronRun } from '@/lib/cron-runs'
import { sendDailyErrorDigest } from '@/lib/app-errors'
import { gcRateLimitStore } from '@/lib/rate-limit-store'
import { sweepMinorCredentialPages } from '@/lib/credential-minor-sweep'
import type { CronRun } from '@/lib/cron-runs'
import type { SupabaseClient } from '@supabase/supabase-js'

// Hobby's ceiling: no lower value is safe to pick without run times to prove it
// (a cron cut short mid-batch loses its run.finish), and it cannot be shorter than
// whatever limit this route ran under before it declared one.
export const maxDuration = 300

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
//
// legal-credential-family-link.4: it also makes private any public credential
// page whose holder is a Minor under the policy with no guardian consent that
// permits it (lib/credential-minor-sweep). The counts go into this run's
// cron_runs result as credentialMinorSweep, a failure is recorded as a run error,
// and it runs whether or not the lifecycle succeeded. The response is unchanged.
export const GET = withCronAudit('entitlements', async (req: NextRequest) => {
  const blocked = guardCron(req)
  if (blocked) return blocked
  // deep review INT-9: record the run in cron_runs so a silently-failing
  // entitlements lifecycle (grants/expiries stopping for weeks) is detectable.
  const db = supabaseServer()
  const run = await startCronRun(db, 'entitlements')
  let result: Record<string, unknown> | null = null
  try {
    result = (await runEntitlementsLifecycle()) as Record<string, unknown>
  } catch (err) {
    console.error('[cron/entitlements]:', err)
    run.fail('run', err)
  }
  const credentialMinorSweep = await credentialMinorSweepStep(db, run)
  await run.finish({ ...(result ?? {}), credentialMinorSweep })
  const errorDigest = await sendDailyErrorDigest(db)
  const rateLimitGc = await gcRateLimitStore(db)
  if (!result) {
    return NextResponse.json({ error: 'lifecycle failed', errorDigest, ...(rateLimitGc ? { rateLimitGc } : {}) }, { status: 500 })
  }
  return NextResponse.json({ ...result, errorDigest, ...(rateLimitGc ? { rateLimitGc } : {}) })
})

/** The sweep as one step of this run: never throws, and records its problems on the run. */
async function credentialMinorSweepStep(db: SupabaseClient, run: CronRun): Promise<Record<string, unknown>> {
  try {
    const sweep = await sweepMinorCredentialPages(db)
    if (sweep.errors > 0) {
      run.fail('credential-minor-sweep', new Error(`${sweep.errors} holder(s) could not be checked or updated`))
    }
    if (sweep.truncated) {
      run.fail('credential-minor-sweep', new Error('stopped at the per-run limit before checking every public page'))
    }
    return { ...sweep }
  } catch (err) {
    console.error('[cron/entitlements] credential minor sweep failed:', err)
    run.fail('credential-minor-sweep', err)
    return { failed: true }
  }
}
