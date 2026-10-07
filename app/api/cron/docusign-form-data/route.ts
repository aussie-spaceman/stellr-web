import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { guardCron } from '@/lib/cron'
import { startCronRun } from '@/lib/cron-runs'
import { recordCredentialOptOutFromForm, OPT_OUT_ENVELOPE_COLUMNS, type OptOutEnvelope } from '@/lib/docusign-optout'
import { runEsignMaintenance } from '@/lib/esign/maintenance'

// GET /api/cron/docusign-form-data
// Vercel cron, daily (see vercel.json).
//
// Reads the opt-out boxes (media, quotes, digital communications, credential
// sharing) off any completed original whose answers are not on file yet: the
// webhook read failed, Connect never delivered the completion, or the form was
// signed before the answers were recorded (form_opt_outs, 7 Oct 2026). No
// age limit, so a read that keeps failing is retried daily and every failure
// is in cron_runs; newest first, at most BATCH a run.

const BATCH = 50
// Each read fetches the signed document and parses it (a second or two). Stop
// starting reads after this, so the housekeeping below still gets its turn;
// the rest are read on the next run.
const READ_BUDGET_MS = 120_000

export async function GET(req: NextRequest) {
  const blocked = guardCron(req)
  if (blocked) return blocked

  const db = supabaseServer()
  const run = await startCronRun(db, 'docusign-form-data')

  const { data, error } = await db
    .from('agreements')
    .select(OPT_OUT_ENVELOPE_COLUMNS)
    // Every agreement type carries a media opt-out (the minor form three more).
    .in('envelope_type', ['minor', 'adult', 'mentor', 'volunteer'])
    .eq('status', 'completed')
    .is('reused_from', null)
    .is('form_opt_outs', null)
    .order('completed_at', { ascending: false })
    .limit(BATCH)
  if (error) {
    run.fail('query', error.message)
    await run.finish({ processed: 0 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const results: Record<string, number> = {}
  const stopAt = Date.now() + READ_BUDGET_MS
  for (const env of (data ?? []) as OptOutEnvelope[]) {
    if (Date.now() >= stopAt) {
      results.deferred = (results.deferred ?? 0) + 1
      continue
    }
    const r = await recordCredentialOptOutFromForm(db, env, { onError: (err) => run.fail(env.id, err) })
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
