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

export const backupName = (envelopeRow: string, kind: 'signed' | 'certificate' | 'audit') =>
  `${envelopeRow}-${kind}.${kind === 'audit' ? 'json' : 'pdf'}.enc`

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
  opts: { limit?: number; now?: Date } = {},
): Promise<{ replicated: number; failed: { id: string; error: string }[] }> {
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
    try {
      if (!row.signed_pdf_path) throw new Error('No stored PDF')
      const pdf = await readStored(db, row.signed_pdf_path)
      if (row.signed_pdf_sha256 && sha256Hex(pdf) !== row.signed_pdf_sha256) {
        throw new Error('Stored PDF no longer matches its recorded hash; not copying a damaged record')
      }
      await store.put(backupName(row.id, 'signed'), encryptBackup(pdf))
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
  for (const kind of ['signed', 'certificate', 'audit'] as const) await store.remove(backupName(envelopeRow, kind))
}
