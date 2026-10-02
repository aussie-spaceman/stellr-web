import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchSignedDocument } from '@/lib/esign/operations'
import { slug } from '@/lib/esign/filenames'
import { SIGNED_BUCKET, archivePaths, putImmutable, retainUntil } from '@/lib/esign/storage'

// Signed agreements are kept in this app, not only at the engine that issued
// them. Until October 2026 both download routes fetched the executed PDF from
// DocuSign on every request, so the day the account lapsed every signed
// consent form would have become unreachable. Layout: lib/esign/storage.ts.

export { SIGNED_BUCKET, RETENTION_YEARS, archivePaths, putImmutable, retainUntil, sha256Hex } from '@/lib/esign/storage'

/** Archive attempts after which the retry job stops and reports the envelope. */
export const MAX_ARCHIVE_ATTEMPTS = 10

/** Signed download links live this long: enough for a slow connection, too short to share. */
const SIGNED_URL_TTL_SECONDS = 120

export interface ArchivableRow {
  id: string
  envelope_id: string
  provider?: string | null
  status: string
  reused_from?: string | null
  completed_at?: string | null
  archived_at?: string | null
  archive_attempts?: number | null
}

export const ARCHIVABLE_COLUMNS =
  'id, envelope_id, provider, status, reused_from, completed_at, archived_at, archive_attempts'

export type ArchiveOutcome =
  | { kind: 'archived'; path: string; sha256: string }
  | { kind: 'skipped'; reason: 'not_completed' | 'coverage_row' | 'already_archived' | 'native' }
  | { kind: 'failed'; error: string }

/**
 * Copies a completed agreement's signed PDF (and the engine's certificate) into
 * the bucket and records where it is and what it hashes to. Idempotent, and
 * never throws: a failure is counted on the row for the retry job.
 *
 * The native engine stores its documents itself while sealing, so its rows are
 * skipped here.
 */
export async function archiveEnvelope(db: SupabaseClient, row: ArchivableRow): Promise<ArchiveOutcome> {
  if (row.status !== 'completed') return { kind: 'skipped', reason: 'not_completed' }
  if (row.reused_from) return { kind: 'skipped', reason: 'coverage_row' }
  if (row.archived_at) return { kind: 'skipped', reason: 'already_archived' }
  if ((row.provider ?? 'docusign') === 'native') return { kind: 'skipped', reason: 'native' }

  try {
    const paths = archivePaths(row)
    const { pdf, certificate } = await fetchSignedDocument(db, row, { certificate: true })
    const sha256 = await putImmutable(db, paths.pdf, pdf, 'application/pdf')
    const certificatePath = certificate
      ? (await putImmutable(db, paths.certificate, certificate, 'application/pdf'), paths.certificate)
      : null

    const now = new Date().toISOString()
    const update: Record<string, unknown> = {
      signed_pdf_path:   paths.pdf,
      signed_pdf_sha256: sha256,
      signed_pdf_bytes:  pdf.byteLength,
      certificate_path:  certificatePath,
      certificate_bytes: certificate?.byteLength ?? null,
      archived_at:       now,
      archive_error:     null,
      updated_at:        now,
    }
    if (row.completed_at) update.retain_until = retainUntil(row.completed_at)
    const { error } = await db.from('agreements').update(update).eq('id', row.id)
    if (error) throw new Error(`Recording the archive failed: ${error.message}`)
    return { kind: 'archived', path: paths.pdf, sha256 }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[esign-archive] ${row.id} failed:`, message)
    await db
      .from('agreements')
      .update({
        archive_attempts: (row.archive_attempts ?? 0) + 1,
        archive_error:    message.slice(0, 1000),
        updated_at:       new Date().toISOString(),
      })
      .eq('id', row.id)
    return { kind: 'failed', error: message }
  }
}

/**
 * Archives up to `limit` completed agreements that have no stored copy yet.
 * Shared by the daily cron and the admin backfill.
 */
export async function archivePending(
  db: SupabaseClient,
  opts: { limit: number; dryRun?: boolean },
): Promise<{ eligible: number; archived: number; failed: { id: string; error: string }[] }> {
  const { data, error } = await db
    .from('agreements')
    .select(ARCHIVABLE_COLUMNS)
    .eq('status', 'completed')
    .is('reused_from', null)
    .is('archived_at', null)
    .eq('provider', 'docusign')
    .lt('archive_attempts', MAX_ARCHIVE_ATTEMPTS)
    .order('completed_at', { ascending: true })
    .limit(opts.limit)
  if (error) throw new Error(`Archive work list query failed: ${error.message}`)

  const rows = (data ?? []) as ArchivableRow[]
  if (opts.dryRun) return { eligible: rows.length, archived: 0, failed: [] }

  let archived = 0
  const failed: { id: string; error: string }[] = []
  // One at a time: DocuSign rate-limits, and the job stays resumable.
  for (const row of rows) {
    const outcome = await archiveEnvelope(db, row)
    if (outcome.kind === 'archived') archived++
    if (outcome.kind === 'failed') failed.push({ id: row.id, error: outcome.error })
  }
  return { eligible: rows.length, archived, failed }
}

// ── Serving a signed record ──────────────────────────────────────────────────

export interface StoredRecordRow extends ArchivableRow {
  signed_pdf_path?: string | null
  certificate_path?: string | null
  restricted_at?: string | null
  envelope_type?: string | null
  minor_name?: string | null
  signer_name?: string | null
}

export const STORED_RECORD_COLUMNS =
  `${ARCHIVABLE_COLUMNS}, signed_pdf_path, certificate_path, restricted_at, envelope_type, minor_name, signer_name`

export type SignedRecord =
  | { kind: 'url'; url: string; filename: string }
  | { kind: 'bytes'; bytes: ArrayBuffer; filename: string }
  | { kind: 'unavailable'; reason: string }

/**
 * A coverage row has no document of its own: it points at the agreement that
 * was signed originally. Returns that original, or the row itself.
 */
export async function resolveOriginal(db: SupabaseClient, row: StoredRecordRow): Promise<StoredRecordRow | null> {
  if (!row.reused_from) return row
  const { data } = await db
    .from('agreements')
    .select(STORED_RECORD_COLUMNS)
    .eq('id', row.reused_from)
    .maybeSingle()
  return (data as StoredRecordRow | null) ?? null
}

export function agreementFilename(row: StoredRecordRow, artifact: 'pdf' | 'certificate'): string {
  const type = row.envelope_type ?? 'minor'
  const prefix = type === 'minor' ? 'consent' : type === 'membership' ? 'membership-agreement' : 'agreement'
  const who = slug(row.minor_name || row.signer_name || 'signed')
  return artifact === 'certificate' ? `${prefix}-${who}-certificate.pdf` : `${prefix}-${who}.pdf`
}

/**
 * The signed PDF (or its certificate) for an original agreement: a short-lived
 * link to the stored copy when there is one. A DocuSign agreement not yet
 * stored is archived on the spot; if that fails, its bytes are fetched live so
 * nobody is refused a document they could download yesterday.
 */
export async function loadSignedRecord(
  db: SupabaseClient,
  original: StoredRecordRow,
  artifact: 'pdf' | 'certificate' = 'pdf',
): Promise<SignedRecord> {
  const filename = agreementFilename(original, artifact)
  let path = artifact === 'pdf' ? original.signed_pdf_path : original.certificate_path

  if (!path && (original.provider ?? 'docusign') === 'docusign') {
    const outcome = await archiveEnvelope(db, original)
    if (outcome.kind === 'archived') {
      const paths = archivePaths(original)
      path = artifact === 'pdf' ? paths.pdf : paths.certificate
    } else {
      try {
        const doc = await fetchSignedDocument(db, original, { certificate: artifact === 'certificate' })
        const bytes = artifact === 'pdf' ? doc.pdf : doc.certificate
        if (bytes) return { kind: 'bytes', bytes, filename }
      } catch (err) {
        console.error(`[esign-archive] live fetch for ${original.id} failed:`, err)
      }
      return { kind: 'unavailable', reason: 'The signed document could not be retrieved. Try again shortly.' }
    }
  }
  if (!path) return { kind: 'unavailable', reason: 'No stored copy of this document exists.' }

  const { data, error } = await db.storage
    .from(SIGNED_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, { download: filename })
  if (error || !data?.signedUrl) {
    console.error(`[esign-archive] signed URL for ${original.id} failed:`, error)
    return { kind: 'unavailable', reason: 'The signed document could not be retrieved. Try again shortly.' }
  }
  return { kind: 'url', url: data.signedUrl, filename }
}

// ── Access log ───────────────────────────────────────────────────────────────

export interface AccessEntry {
  envelopeRow: string
  action: 'view' | 'download' | 'certificate' | 'export'
  actorType: 'admin' | 'member' | 'signer' | 'system'
  actorId: string | null
  detail?: Record<string, unknown>
}

/** Records who opened a signed record. Never throws. */
export async function logRecordAccess(db: SupabaseClient, entry: AccessEntry): Promise<void> {
  try {
    const { error } = await db.from('esign_access_log').insert({
      envelope_row: entry.envelopeRow,
      action:       entry.action,
      actor_type:   entry.actorType,
      actor_id:     entry.actorId,
      detail:       entry.detail ?? {},
    })
    if (error) console.error('[esign-archive] access log write failed:', error.message)
  } catch (err) {
    console.error('[esign-archive] access log write failed:', err)
  }
}
