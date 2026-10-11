import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { guardCron } from '@/lib/cron'
import { startCronRun } from '@/lib/cron-runs'
import { notifyCommunityAdmins } from '@/lib/notify'
import { purgeExpiredArchives, ARCHIVE_PURGE_BATCH, ARCHIVE_RETENTION_YEARS } from '@/lib/deletion/archive-retention'

// GET /api/cron/deletion-archive-retention
// Vercel cron, monthly (see vercel.json).
//
// deep review MP-7: `deletion_archive` keeps a `select('*')` recovery snapshot
// (DOB, emergency contacts, ethnicity, health) of every hard-deleted member,
// participant and registration, and had no retention purge — a "deleted"
// child's PII persisted indefinitely. This purges each snapshot once it has
// aged out, matching the 7-year signed-agreement retention (Privacy Policy
// §10; lib/deletion/archive-retention.ts). The first rows fall due in 2033, so
// this reports purged:0 until then; it exists so the duty cannot silently
// lapse. Every run — and every failure — is recorded in cron_runs (INT-9).
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const blocked = guardCron(req)
  if (blocked) return blocked

  const db = supabaseServer()
  const run = await startCronRun(db, 'deletion-archive-retention')
  try {
    const result = await purgeExpiredArchives(db, { limit: ARCHIVE_PURGE_BATCH })
    for (const f of result.failed) run.fail(f.id, f.error)
    await run.finish({ retentionYears: ARCHIVE_RETENTION_YEARS, eligible: result.eligible, purged: result.purged })

    // Surface failures to a person, not just the ledger: a read/delete error
    // here means a minor's archived PII may be overdue for erasure (MP-7).
    if (result.failed.length) {
      const body =
        `Deletion-archive retention could not delete ${result.failed.length} overdue snapshot(s). ` +
        'Archived personal data of deleted members/participants may be past its retention date. ' +
        'Check the deletion-archive-retention run in cron_runs and the database.'
      await notifyCommunityAdmins({
        type: 'action',
        body,
        email: { subject: 'Deletion-archive retention purge failed', html: `<p>${body}</p>`, text: body },
      }).catch(() => {})
    }

    return NextResponse.json({ eligible: result.eligible, purged: result.purged, failures: result.failed.length })
  } catch (err) {
    // Fail closed: a read/delete error is a failure, not "nothing was due".
    run.fail('purge', err)
    await run.finish({ retentionYears: ARCHIVE_RETENTION_YEARS })
    const message = err instanceof Error ? err.message : String(err)
    const body =
      'Deletion-archive retention could not run: ' +
      `${message}. Archived personal data of deleted members/participants may be past its ` +
      'retention date. Check the deletion-archive-retention run in cron_runs and the database.'
    await notifyCommunityAdmins({
      type: 'action',
      body,
      email: { subject: 'Deletion-archive retention purge failed', html: `<p>${body}</p>`, text: body },
    }).catch(() => {})
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
