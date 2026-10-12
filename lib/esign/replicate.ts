import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SIGNED_BUCKET, sha256Hex } from '@/lib/esign/storage'
import { encryptBackup } from '@/lib/esign/backup-crypto'
import type { BackupStore } from '@/lib/esign/backup-store'

// The second copy of every signed record, and of the agreement tables.
//
// Supabase's free plan keeps no database backups, so this is the recovery
// path: nightly, each newly stored signed PDF and its certificate or audit
// file are encrypted and copied off-site, and the agreement tables are
// exported (encrypted) alongside them. The day's audit-trail chain heads go
// with the export, so the trail can be checked against a copy the database
// cannot rewrite. Deleting a record at the end of its retention deletes its
// copies too.

const EXPORT_PREFIX = 'export-'
const KEEP_EXPORTS = 30

// deep review ES-5: the signed PDF changes when the certificate seal is applied
// (certificate-seal.ts rewrites signed_pdf_path/sha and clears replicated_at to
// force a re-copy). The backup name used to be content-independent and `put` is
// write-once, so the re-copy found the pre-seal name and silently skipped —
// leaving the off-site copy holding bytes that no longer match the row's
// signed_pdf_sha256, so every restore of a sealed record failed its hash check.
// Keying the signed copy's name on its content hash means the sealed bytes get a
// new name and are actually copied. The certificate/audit file does not change
// on seal, so those names stay stable. `removeReplicas` sweeps by prefix so both
// the pre-seal and sealed signed copies are removed at retention.
export const SIGNED_BACKUP_PREFIX = (envelopeRow: string) => `${envelopeRow}-signed`

export const backupName = (
  envelopeRow: string,
  kind: 'signed' | 'certificate' | 'audit',
  sha?: string | null,
): string => {
  if (kind === 'signed') return `${envelopeRow}-signed${sha ? `-${sha.slice(0, 16)}` : ''}.pdf.enc`
  return `${envelopeRow}-${kind}.${kind === 'audit' ? 'json' : 'pdf'}.enc`
}

interface ReplicableRow {
  id: string
  provider: string | null
  signed_pdf_path: string | null
  signed_pdf_sha256: string | null
  certificate_path: string | null
}

async function readStored(db: SupabaseClient, path: string): Promise<Uint8Array> {
  const { data, error } = await db.storage.from(SIGNED_BUCKET).download(path)
  if (error || !data) throw new Error(`Stored record ${path} could not be read`)
  return new Uint8Array(await data.arrayBuffer())
}

/** Copies signed records not yet replicated. Never throws per row; failures are returned. */
export async function replicatePending(
  db: SupabaseClient,
  store: BackupStore,
  opts: {
    limit?: number
    now?: Date
    /**
     * When to stop starting new records (epoch ms). Each takes ~5 s against
     * Drive, so a full batch outlasts the admin button's 60 s function limit;
     * what is left is copied by the next run.
     */
    deadline?: number
  } = {},
): Promise<{ replicated: number; failed: { id: string; error: string }[]; stoppedEarly?: true }> {
  const { data, error } = await db
    .from('agreements')
    .select('id, provider, signed_pdf_path, signed_pdf_sha256, certificate_path')
    .not('archived_at', 'is', null)
    .is('replicated_at', null)
    .order('archived_at', { ascending: true })
    .limit(opts.limit ?? 25)
  if (error) throw new Error(`Replication work list query failed: ${error.message}`)

  let replicated = 0
  const failed: { id: string; error: string }[] = []
  for (const row of (data ?? []) as ReplicableRow[]) {
    if (opts.deadline !== undefined && Date.now() >= opts.deadline) return { replicated, failed, stoppedEarly: true }
    try {
      if (!row.signed_pdf_path) throw new Error('No stored PDF')
      const pdf = await readStored(db, row.signed_pdf_path)
      if (row.signed_pdf_sha256 && sha256Hex(pdf) !== row.signed_pdf_sha256) {
        throw new Error('Stored PDF no longer matches its recorded hash; not copying a damaged record')
      }
      // deep review ES-5: name the signed copy by its content hash so a sealed
      // version (a different hash) is copied rather than skipped as "already
      // present" against the pre-seal name.
      await store.put(backupName(row.id, 'signed', row.signed_pdf_sha256), encryptBackup(pdf))
      if (row.certificate_path) {
        const kind = (row.provider ?? 'docusign') === 'native' ? 'audit' : 'certificate'
        await store.put(backupName(row.id, kind), encryptBackup(await readStored(db, row.certificate_path)))
      }
      await db.from('agreements').update({ replicated_at: (opts.now ?? new Date()).toISOString() }).eq('id', row.id)
      replicated++
    } catch (err) {
      failed.push({ id: row.id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { replicated, failed }
}

const EXPORT_TABLES = [
  { table: 'agreements', order: 'created_at' },
  { table: 'agreement_recipients', order: 'created_at' },
  { table: 'esign_audit_events', order: 'id' },
  { table: 'esign_access_log', order: 'id' },
  { table: 'esign_templates', order: 'created_at' },
  { table: 'esign_provider_state', order: 'updated_at' },
] as const

async function readAll(db: SupabaseClient, table: string, order: string): Promise<unknown[]> {
  const out: unknown[] = []
  const page = 1000
  for (let from = 0; ; from += page) {
    const { data, error } = await db.from(table).select('*').order(order, { ascending: true }).range(from, from + page - 1)
    if (error) throw new Error(`Export of ${table} failed: ${error.message}`)
    out.push(...(data ?? []))
    if (!data || data.length < page) return out
  }
}

/**
 * The nightly encrypted export of the agreement tables, with the audit-trail
 * anchor. Keeps the last 30 days.
 */
export async function exportTables(
  db: SupabaseClient,
  store: BackupStore,
  now = new Date(),
): Promise<{ name: string; rows: Record<string, number>; anchor: string; pruned: number }> {
  const tables: Record<string, unknown[]> = {}
  for (const t of EXPORT_TABLES) tables[t.table] = await readAll(db, t.table, t.order)

  const { data: heads, error } = await db.rpc('esign_audit_heads')
  if (error) throw new Error(`Audit chain heads could not be read: ${error.message}`)
  const headList = ((heads ?? []) as { envelope_row: string; last_id: number; hash: string }[])
    .sort((a, b) => a.envelope_row.localeCompare(b.envelope_row))
  // One hash over every chain head: the value to compare a later database against.
  const anchor = createHash('sha256').update(headList.map((h) => `${h.envelope_row}:${h.last_id}:${h.hash}`).join('\n')).digest('hex')

  const day = now.toISOString().slice(0, 10)
  const name = `${EXPORT_PREFIX}${day}.json.enc`
  const payload = { exportedAt: now.toISOString(), anchor, heads: headList, tables }
  await store.put(name, encryptBackup(new TextEncoder().encode(JSON.stringify(payload))))

  // Keep the last KEEP_EXPORTS daily exports.
  const all = await store.list(EXPORT_PREFIX)
  let pruned = 0
  for (const old of all.slice(KEEP_EXPORTS)) if (await store.remove(old)) pruned++

  return {
    name,
    rows: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
    anchor,
    pruned,
  }
}

/** Removes a record's off-site copies, at the end of its retention period. */
export async function removeReplicas(store: BackupStore, envelopeRow: string): Promise<void> {
  // deep review ES-5: the signed copy's name is content-keyed, so there can be a
  // pre-seal and a sealed copy (and legacy un-suffixed copies); sweep every
  // `<row>-signed*` name. The certificate/audit names are stable.
  for (const name of await store.list(SIGNED_BACKUP_PREFIX(envelopeRow))) await store.remove(name)
  for (const kind of ['certificate', 'audit'] as const) await store.remove(backupName(envelopeRow, kind))
}
