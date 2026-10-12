import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getBackgroundProvider } from '@/lib/background-provider'
import { syncStaleChecks } from '@/lib/background-sync'
import { guardCron } from '@/lib/cron'
import { startCronRun } from '@/lib/cron-runs'
import { notifyCommunityAdmins } from '@/lib/notify'

export const maxDuration = 60

// GET /api/cron/background-sync
// Vercel cron calls this daily (see vercel.json). Re-polls every open
// background check against the provider and applies any outcome whose webhook
// we missed. See lib/background-sync.ts for why this exists.
//
// Rows touched in the last hour are skipped so we never race a webhook that
// is about to land. guardCron means this only runs where APP_ENV=prod; on the
// dev deployment use the admin "Sync now" button instead.

const MIN_AGE_MINUTES = 60

export async function GET(req: NextRequest) {
  const blocked = guardCron(req)
  if (blocked) return blocked

  const provider = getBackgroundProvider()
  if (!provider.configured()) {
    return NextResponse.json({ skipped: true, reason: `${provider.name} not configured` })
  }

  const db = supabaseServer()

  // deep review BG-8: this sweep is the only thing that re-checks a stuck row, yet
  // it recorded nothing and alerted nobody. A revoked/rotated CHECKR_API_KEY makes
  // every row error 401 every day, silently — the exact "nothing ever looked
  // again" failure the sync was built to stop. Every run now lands in cron_runs
  // (the durable signal, since Vercel keeps logs only an hour), and when the whole
  // sweep errors with nothing advanced we raise an admin alert instead of
  // swallowing it behind a 200.
  const run = await startCronRun(db, 'background-sync')
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

    await run.finish({ scanned: result.scanned, updated: result.updated, unchanged: result.unchanged, errors: result.errors.length })
    console.log('[cron:background-sync]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    // A failure of the load query itself (not a per-row error) would otherwise
    // surface only as an opaque 500. Record it so "did it run and fail?" stays
    // answerable from the database.
    run.fail('sync', err)
    await run.finish({})
    console.error('[cron:background-sync] sync threw:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
