import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { runEntitlementsLifecycle } from '@/lib/entitlements'
import { guardCron } from '@/lib/cron'
import { startCronRun } from '@/lib/cron-runs'

// GET /api/cron/entitlements — runs daily (see vercel.json).
// Re-grants per-period tier allowances (e.g. the quarterly free mentoring
// cohort) into the entitlements ledger, and expires granted lots whose
// membership has lapsed. Idempotent: a no-op until a new period opens or a
// membership lapses. Purchased entitlements are never touched.
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
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cron/entitlements]:', err)
    run.fail('run', err)
    await run.finish({})
    return NextResponse.json({ error: 'lifecycle failed' }, { status: 500 })
  }
}
