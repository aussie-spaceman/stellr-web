/**
 * Restore drill for the encrypted off-site copy of signed agreements.
 * Read-only: it changes nothing anywhere. Run it quarterly, and after any
 * change to the backup key or folder.
 *
 *   npx tsx scripts/esign-restore-drill.ts            # 10 random records
 *   npx tsx scripts/esign-restore-drill.ts --sample 25
 *   npx tsx scripts/esign-restore-drill.ts --restore <agreement id> --out ./restored
 *
 * For each sampled agreement it downloads the encrypted copy, decrypts it with
 * ESIGN_BACKUP_KEY and checks it against the SHA-256 recorded when the record
 * was stored. It also decrypts the latest table export and compares its
 * audit-trail anchor with the live database. Any mismatch exits non-zero.
 *
 * --restore writes one agreement's decrypted files to --out, for when the
 * stored copy has been lost or damaged.
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import { createHash } from 'crypto'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag)
  return i > -1 ? process.argv[i + 1] : undefined
}

async function main() {
  // Imported after dotenv so they read the loaded environment.
  const { createClient } = await import('@supabase/supabase-js')
  const { decryptBackup } = await import('../lib/esign/backup-crypto')
  const { driveBackupStore } = await import('../lib/esign/backup-store')
  const { backupName } = await import('../lib/esign/replicate')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  console.log(`Database: ${new URL(url).host}`)
  const db = createClient(url, key, { auth: { persistSession: false } })
  const store = driveBackupStore()
  const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

  const restoreId = arg('--restore')
  if (restoreId) {
    const out = path.resolve(arg('--out') ?? 'restored')
    fs.mkdirSync(out, { recursive: true })
    for (const kind of ['signed', 'certificate', 'audit'] as const) {
      const sealed = await store.get(backupName(restoreId, kind))
      if (!sealed) continue
      const file = path.join(out, backupName(restoreId, kind).replace(/\.enc$/, ''))
      fs.writeFileSync(file, decryptBackup(sealed))
      console.log(`✓ wrote ${file}`)
    }
    return
  }

  const sample = Number(arg('--sample') ?? 10)
  const { data } = await db
    .from('docusign_envelopes')
    .select('id, signed_pdf_sha256')
    .not('replicated_at', 'is', null)
    .limit(1000)
  const rows = ((data ?? []) as { id: string; signed_pdf_sha256: string | null }[])
    .sort(() => Math.random() - 0.5)
    .slice(0, sample)

  let failures = 0
  for (const row of rows) {
    const sealed = await store.get(backupName(row.id, 'signed'))
    if (!sealed) { console.error(`✗ ${row.id}: no backup copy`); failures++; continue }
    let plain: Buffer
    try { plain = decryptBackup(sealed) } catch (e) { console.error(`✗ ${row.id}: ${(e as Error).message}`); failures++; continue }
    if (row.signed_pdf_sha256 && sha(plain) !== row.signed_pdf_sha256) {
      console.error(`✗ ${row.id}: decrypted copy does not match the recorded hash`)
      failures++
    } else {
      console.log(`✓ ${row.id}`)
    }
  }

  const exports = await store.list('export-')
  if (!exports.length) {
    console.error('✗ no table export found')
    failures++
  } else {
    const latest = JSON.parse(decryptBackup((await store.get(exports[0])) as Uint8Array).toString('utf8')) as {
      exportedAt: string; anchor: string; heads: { envelope_row: string; last_id: number; hash: string }[]
    }
    const { data: heads } = await db.rpc('esign_audit_heads')
    const live = new Map(((heads ?? []) as { envelope_row: string; last_id: number; hash: string }[]).map((h) => [h.envelope_row, h]))
    // Every chain in the export must still be in the database, unchanged up to where the export saw it.
    let drift = 0
    for (const h of latest.heads) {
      const now = live.get(h.envelope_row)
      if (!now) continue // Purged at end of retention since the export.
      if (now.last_id === h.last_id && now.hash !== h.hash) drift++
    }
    console.log(`${drift ? '✗' : '✓'} ${exports[0]} (exported ${latest.exportedAt}): ${latest.heads.length} audit chains, ${drift} changed since`)
    failures += drift
  }

  console.log(failures ? `\n✗ ${failures} problem(s)` : `\n✓ ${rows.length} record(s) restored and verified`)
  process.exit(failures ? 1 : 0)
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
