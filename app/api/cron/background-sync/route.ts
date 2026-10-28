import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getBackgroundProvider } from '@/lib/background-provider'
import { syncStaleChecks } from '@/lib/background-sync'
import { remindUnclearedAdults, type ReminderRunResult } from '@/lib/compliance-notify'
import { guardCron } from '@/lib/cron'
import { startCronRun } from '@/lib/cron-runs'
import { notifyCommunityAdmins } from '@/lib/notify'

export const maxDuration = 60

// GET /api/cron/background-sync
// Vercel cron calls this daily (see vercel.json). Two steps:
//
//   1. Re-polls every open background check against the provider and applies
//      any outcome whose webhook we missed. See lib/background-sync.ts for why
//      this exists. Rows touched in the last hour are skipped so we never race a
//      webhook that is about to land.
//   2. Reminds adults taking part in an event 0–14 days away who are still not
//      cleared (lib/compliance-notify.ts). Independent of step 1: it runs when
//      the provider is unconfigured or the sync fails, since a teaching license
//      clears someone without any provider at all.
//
// guardCron means this only runs where APP_ENV=prod; on the dev deployment use
// the admin "Sync now" button for step 1.

const MIN_AGE_MINUTES = 60
/** Stop starting reminder emails once this much of the 60s budget is gone. */
const REMINDER_BUDGET_MS = 45_000

type ReminderSummary = Omit<ReminderRunResult, 'errors'> & { errors: number }

export async function GET(req: NextRequest) {
  const blocked = guardCron(req)
  if (blocked) return blocked

  const started = Date.now()
  const db = supabaseServer()

  // deep review BG-8: this sweep is the only thing that re-checks a stuck row, yet
  // it recorded nothing and alerted nobody. A revoked/rotated CHECKR_API_KEY makes
  // every row error 401 every day, silently — the exact "nothing ever looked
  // again" failure the sync was built to stop. Every run now lands in cron_runs
  // (the durable signal, since Vercel keeps logs only an hour), and when the whole
  // sweep errors with nothing advanced we raise an admin alert instead of
  // swallowing it behind a 200.
  const run = await startCronRun(db, 'background-sync')

  let sync: Record<string, unknown>
  let syncFailed: string | null = null
  const provider = getBackgroundProvider()
  if (!provider.configured()) {
    sync = { skipped: true, reason: `${provider.name} not configured` }
  } else {
    try {
      const result = await syncStaleChecks(db, provider, { minAgeMinutes: MIN_AGE_MINUTES })
      for (const e of result.errors) run.fail(e.id, e.error)

      if (result.errors.length > 0 && result.updated === 0) {
        try {
          await notifyCommunityAdmins({
            type: 'action',
            body:
              `The daily background-check sync could not update any of ${result.scanned} open check(s): ` +
              `every attempt errored. This usually means the background-check provider is unreachable or ` +
              `its API key is invalid — open checks will not progress until it is fixed.`,
            referenceType: 'cron',
            referenceId: 'background-sync',
          })
        } catch (err) {
          // The alert is best-effort; never let it mask the run we just recorded.
          console.error('[cron:background-sync] all-error alert failed:', err)
        }
      }
      sync = { scanned: result.scanned, updated: result.updated, unchanged: result.unchanged, errors: result.errors.length }
      console.log('[cron:background-sync]', JSON.stringify(result))
    } catch (err) {
      // A failure of the load query itself (not a per-row error) would otherwise
      // surface only as an opaque 500. Record it so "did it run and fail?" stays
      // answerable from the database.
      run.fail('sync', err)
      syncFailed = err instanceof Error ? err.message : String(err)
      sync = { error: syncFailed }
      console.error('[cron:background-sync] sync threw:', err)
    }
  }

  let reminders: ReminderSummary | { error: string }
  try {
    const r = await remindUnclearedAdults(db, {
      now: new Date(),
      canContinue: () => Date.now() - started <= REMINDER_BUDGET_MS,
    })
    for (const e of r.errors) run.fail(`reminder:${e.where}`, e.error)
    reminders = { ...r, errors: r.errors.length }
    console.log('[cron:background-sync] reminders', JSON.stringify(reminders))
  } catch (err) {
    run.fail('reminders', err)
    reminders = { error: err instanceof Error ? err.message : String(err) }
    console.error('[cron:background-sync] reminders threw:', err)
  }

  await run.finish({ ...sync, reminders })
  if (syncFailed) return NextResponse.json({ error: syncFailed, reminders }, { status: 500 })
  return NextResponse.json({ ...sync, reminders })
}
