import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { guardCron } from '@/lib/cron'
import { startCronRun } from '@/lib/cron-runs'
import { recordCredentialOptOutFromForm, OPT_OUT_ENVELOPE_COLUMNS, type OptOutEnvelope } from '@/lib/docusign-optout'
import { runEsignMaintenance } from '@/lib/esign/maintenance'

// GET /api/cron/docusign-form-data
// Vercel cron, daily (see vercel.json).
//
// Retries the credential-sharing opt-out read for completed minor consent
// forms whose form data was never read — the webhook read failed, or Connect
// never delivered the completion. Looks back 7 days; older misses are a
// manual job (admin Consent forms table).

const LOOKBACK_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

export async function GET(req: NextRequest) {
  const blocked = guardCron(req)
  if (blocked) return blocked

  const db = supabaseServer()
  const run = await startCronRun(db, 'docusign-form-data')
  const since = new Date(Date.now() - LOOKBACK_DAYS * DAY_MS).toISOString()

  const { data, error } = await db
    .from('agreements')
    .select(OPT_OUT_ENVELOPE_COLUMNS)
    .eq('envelope_type', 'minor')
    .eq('status', 'completed')
    .is('reused_from', null)
    .is('form_data_read_at', null)
    .gte('completed_at', since)
    .limit(50)
  if (error) {
    run.fail('query', error.message)
    await run.finish({ processed: 0 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const results: Record<string, number> = {}
  for (const env of (data ?? []) as OptOutEnvelope[]) {
    const r = await recordCredentialOptOutFromForm(db, env)
    results[r] = (results[r] ?? 0) + 1
  }
  await run.finish({ processed: data?.length ?? 0, results })

  // The signed-record housekeeping rides on this cron's daily slot: Vercel
  // Hobby allows each cron entry to run at most once a day, and the schedule is
  // already long. It records its own cron_runs row.
  const maintenanceRun = await startCronRun(db, 'esign-maintenance')
  const maintenance = await runEsignMaintenance(db, {
    onError: (step, err) => maintenanceRun.fail(step, err),
  })
  await maintenanceRun.finish(maintenance)

  return NextResponse.json({ processed: data?.length ?? 0, results, maintenance })
}
