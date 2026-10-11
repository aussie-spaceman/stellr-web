import type { SupabaseClient } from '@supabase/supabase-js'
import { RETENTION_YEARS } from '@/lib/esign/storage'

// deep review MP-7: the recovery snapshots written to `deletion_archive` before
// a hard purge (lib/deletion/archive.ts) are a `select('*')` of the deleted
// rows — a participant/registration snapshot holds the child's DOB, emergency
// contacts, ethnicity and (until the medical job strips it) health data. The
// archive had NO retention purge, so a "deleted" child's full PII persisted
// indefinitely: the medical job clears only `health_conditions`, and the
// privacy runbook deletes only `member`-type snapshots, and only when a
// deletion request happens to name that member.
//
// This purges EVERY archived snapshot once it has aged out, so the recovery
// window closes on schedule for participant/registration/member rows alike.
//
// The clock, and why it reuses the e-sign constant: the 7-year period is the
// same Privacy Policy §10 duty that governs signed agreements (lib/esign/
// storage.ts `RETENTION_YEARS`), so it is imported rather than re-declared —
// one source, no drift. The archive row's own `deleted_at` (set to now() when
// the snapshot is written, at the hard delete) is the only timestamp it
// carries and the correct point to measure from: the recovery copy exists from
// that moment, so 7 years later it is purged. The first rows fall due in 2033
// (the table was created in 2026), so on production this purges nothing for
// years — it exists so the retention duty cannot silently lapse.

/** Years a recovery snapshot is kept before purge — the §10 duty, shared with signed agreements. */
export const ARCHIVE_RETENTION_YEARS = RETENTION_YEARS

/** Rows examined per run. A monthly job with a plain row delete; generous. */
export const ARCHIVE_PURGE_BATCH = 1000

/** The cutoff: snapshots with `deleted_at` at or before this are due. */
export function archivePurgeCutoff(now: Date): string {
  const d = new Date(now)
  d.setUTCFullYear(d.getUTCFullYear() - ARCHIVE_RETENTION_YEARS)
  return d.toISOString()
}

export interface ArchivePurgeResult {
  /** How many due rows this run examined (capped at `limit`). */
  eligible: number
  /** How many were deleted. */
  purged: number
  /**
   * Surfaced errors. A read or delete failure throws (see below) so the caller
   * records it on the cron ledger and alerts — never swallowed into a success
   * that reads as "nothing was due". Kept for shape parity with the e-sign
   * `PurgeResult`; populated only if a future per-row variant needs it.
   */
  failed: { id: string; error: string }[]
}

/**
 * Deletes `deletion_archive` rows whose recovery window has ended (deep review
 * MP-7). Idempotent: it selects the due rows, deletes them by id, and a rerun
 * simply finds whatever is still due. At most `limit` rows a run; any backlog
 * beyond that drains on the next run, so a large one-off never has to fit in a
 * single invocation.
 *
 * Fails CLOSED (QUAL-6 / the teardown-error lesson): a read or delete error is
 * re-thrown, not treated as "no rows". A swallowed read error here would make
 * the purge silently do nothing while reporting success — exactly how an outage
 * reads as "no rows" — leaving a minor's archived PII in place unnoticed.
 */
export async function purgeExpiredArchives(
  db: SupabaseClient,
  opts: { limit: number; dryRun?: boolean; now?: Date },
): Promise<ArchivePurgeResult> {
  const now = opts.now ?? new Date()
  const cutoff = archivePurgeCutoff(now)

  const { data, error } = await db
    .from('deletion_archive')
    .select('id, deleted_at')
    .lte('deleted_at', cutoff)
    .order('deleted_at', { ascending: true })
    .limit(opts.limit)
  if (error) throw new Error(`Deletion-archive retention work list query failed: ${error.message}`)

  const rows = (data ?? []) as { id: string; deleted_at: string }[]
  if (opts.dryRun) return { eligible: rows.length, purged: 0, failed: [] }
  if (rows.length === 0) return { eligible: 0, purged: 0, failed: [] }

  const ids = rows.map((r) => r.id)
  const { data: deleted, error: delError } = await db
    .from('deletion_archive')
    .delete()
    .in('id', ids)
    .select('id')
  if (delError) throw new Error(`Deletion-archive row delete failed: ${delError.message}`)

  return { eligible: rows.length, purged: deleted?.length ?? 0, failed: [] }
}
