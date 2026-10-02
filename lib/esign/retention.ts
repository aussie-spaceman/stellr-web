import type { SupabaseClient } from '@supabase/supabase-js'
import { SIGNED_BUCKET } from '@/lib/esign/storage'

// What happens to signed agreements when the people they belong to are deleted,
// and when their retention period ends.
//
// The rule (owner's decision, 2 Oct 2026; Privacy Policy §10): a signed
// agreement is kept for 7 years from signing, then deleted. Deleting a
// participant, a registration or a member before then does not delete the
// agreement: it is unlinked and RESTRICTED — kept only so it can be produced if
// a claim is made, shown to nobody, used for nothing. Unsigned agreements carry
// no such duty and go with the person.

export type RetentionScope =
  | { kind: 'participant'; id: string }
  | { kind: 'registration'; id: string }
  | { kind: 'member'; id: string }

async function participantIdsFor(db: SupabaseClient, scope: RetentionScope): Promise<string[]> {
  if (scope.kind === 'participant') return [scope.id]
  if (scope.kind !== 'registration') return []
  const { data } = await db.from('participants').select('id').eq('registration_id', scope.id)
  return (data ?? []).map((p) => (p as { id: string }).id)
}

/**
 * Run BEFORE the rows are deleted. Restricts the signed agreements in scope and
 * removes the unsigned ones. Throws on a database error: a delete that would
 * otherwise orphan or lose signed records must not proceed half-done.
 */
export async function retainSignedRecords(
  db: SupabaseClient,
  scope: RetentionScope,
  now = new Date(),
): Promise<{ restricted: number; removedUnsigned: number }> {
  const column = scope.kind === 'member' ? 'member_id' : 'participant_id'
  const ids = scope.kind === 'member' ? [scope.id] : await participantIdsFor(db, scope)
  if (ids.length === 0) return { restricted: 0, removedUnsigned: 0 }

  const { data: restricted, error: restrictError } = await db
    .from('docusign_envelopes')
    .update({ restricted_at: now.toISOString(), updated_at: now.toISOString() })
    .in(column, ids)
    .eq('status', 'completed')
    .is('restricted_at', null)
    .select('id')
  if (restrictError) throw new Error(`Restricting signed agreements failed: ${restrictError.message}`)

  // A member keeps their unsigned rows' history through member_id = NULL as
  // before; only a participant's dead paperwork is removed with them.
  let removedUnsigned = 0
  if (scope.kind !== 'member') {
    const { data: removed, error: removeError } = await db
      .from('docusign_envelopes')
      .delete()
      .in('participant_id', ids)
      .neq('status', 'completed')
      .select('id')
    if (removeError) throw new Error(`Removing unsigned agreements failed: ${removeError.message}`)
    removedUnsigned = removed?.length ?? 0
  }

  return { restricted: restricted?.length ?? 0, removedUnsigned }
}

/**
 * Restricts one person's signed agreements in answer to a deletion request,
 * without deleting the person. Returns how many were restricted.
 */
export async function restrictForRequest(db: SupabaseClient, memberId: string, now = new Date()): Promise<number> {
  const { restricted } = await retainSignedRecords(db, { kind: 'member', id: memberId }, now)
  return restricted
}

export interface PurgeResult {
  eligible: number
  purged: number
  failed: { id: string; error: string }[]
}

/**
 * Deletes signed agreements whose retention period has ended: the stored PDF
 * and certificate, then the row (its recipient rows and any coverage rows that
 * pointed at it go by cascade). The access log is kept: it records who looked
 * at what, and holds no copy of the document.
 */
export async function purgeExpired(
  db: SupabaseClient,
  opts: { limit: number; dryRun?: boolean; now?: Date },
): Promise<PurgeResult> {
  const now = opts.now ?? new Date()
  const { data, error } = await db
    .from('docusign_envelopes')
    .select('id, signed_pdf_path, certificate_path')
    .lte('retain_until', now.toISOString())
    .order('retain_until', { ascending: true })
    .limit(opts.limit)
  if (error) throw new Error(`Retention work list query failed: ${error.message}`)

  const rows = (data ?? []) as { id: string; signed_pdf_path: string | null; certificate_path: string | null }[]
  if (opts.dryRun) return { eligible: rows.length, purged: 0, failed: [] }

  let purged = 0
  const failed: { id: string; error: string }[] = []
  for (const row of rows) {
    try {
      const paths = [row.signed_pdf_path, row.certificate_path].filter((p): p is string => !!p)
      if (paths.length) {
        const { error: storageError } = await db.storage.from(SIGNED_BUCKET).remove(paths)
        if (storageError) throw new Error(`Storage delete failed: ${storageError.message}`)
      }
      // The audit trail is append-only; only this function may remove it.
      const { error: auditError } = await db.rpc('esign_purge_audit', { p_envelope: row.id })
      if (auditError) throw new Error(`Audit trail delete failed: ${auditError.message}`)
      const { error: rowError } = await db.from('docusign_envelopes').delete().eq('id', row.id)
      if (rowError) throw new Error(`Row delete failed: ${rowError.message}`)
      purged++
    } catch (err) {
      failed.push({ id: row.id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { eligible: rows.length, purged, failed }
}
