/**
 * Report where sensitive plaintext (health, dietary, emergency and guardian
 * contact) still exists, and whether its S4 ciphertext is in place. Read-only.
 * docs/FIELD-CRYPTO.md describes the two gates.
 *
 *   npx tsx scripts/scan-plaintext-sensitive.ts                    # full report (tables, audit_log, deletion_archive, exporters)
 *   npx tsx scripts/scan-plaintext-sensitive.ts --verify           # also decrypt every ciphertext and compare (needs the master key)
 *   npx tsx scripts/scan-plaintext-sensitive.ts --code-only        # exporters only, no database
 *   npx tsx scripts/scan-plaintext-sensitive.ts --gate coverage    # exit 2 unless every plaintext value has a current ciphertext
 *   npx tsx scripts/scan-plaintext-sensitive.ts --gate plaintext   # exit 2 if ANY sensitive plaintext remains (the S4 cut-over gate)
 *
 * What it looks at:
 *   - participants, members, member_pending_consent: per column, plaintext
 *     values, ciphertexts, values missing a ciphertext or blind index, and
 *     ciphertexts whose plaintext was cleared (retention must clear both);
 *   - per column, values still under a retired data key (a DEK rotation is
 *     finished only when this is 0; read from the key id, no master key);
 *   - audit_log (whole-row images from the members trigger) and
 *     deletion_archive (nested snapshots): rows holding sensitive keys;
 *   - agreements.prefill and agreement_recipients.signer_values: the e-sign
 *     copies of guardian and emergency contact details;
 *   - source files that read a sensitive column and write a CSV, a Sheet or a
 *     download: the exporters that must become encrypted-aware.
 *
 * Prints counts and file paths only — never a value, an id or key material.
 * Safe against production (it only reads); it says which project it read.
 *
 * Prerequisites (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY;
 * FIELD_CRYPTO_MASTER_KEY + FIELD_CRYPTO_KEY_ID for --verify.
 */
import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import { supabaseServer } from '../lib/supabase'
import { SECRET_KEY_VARS, supabaseSecretKey } from '../lib/supabase-keys'
import { FieldCrypto, loadMasterKeyring } from '../lib/field-crypto'
import { supabaseDekStore } from '../lib/field-crypto-store'
import { encodeFieldValue, rowTenantId, shadowSelect, type ShadowRow } from '../lib/field-crypto-patch'
import { SENSITIVE_TABLES, encColumn } from '../lib/field-crypto-fields'
import {
  agreementHoldsPlaintext,
  countSensitiveKeys,
  exporterFiles,
  gateFailures,
  tableCoverage,
  type ColumnCoverage,
  type Gate,
  type ScanReport,
} from '../lib/field-crypto-scan'
import { PRODUCTION_SUPABASE_REF } from './production-guard.mjs'

const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config(fs.existsSync(envPath) ? { path: envPath } : {})

const argv = process.argv.slice(2)
const VERIFY = argv.includes('--verify')
const CODE_ONLY = argv.includes('--code-only')
const gateArg = argv.includes('--gate') ? argv[argv.indexOf('--gate') + 1] : undefined
const PAGE = 1000

function sourceFiles(dir: string, out: Array<[string, string]> = []): Array<[string, string]> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(p, out)
    else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) out.push([p, fs.readFileSync(p, 'utf8')])
  }
  return out
}

function scanExporters() {
  const files = ['app', 'lib', 'components', 'scripts']
    .filter((d) => fs.existsSync(d))
    .flatMap((d) => sourceFiles(d))
  return exporterFiles(files)
}

async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: { code?: string } | null }>, label: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1)
    if (error) throw new Error(`Cannot read ${label} (${error.code ?? 'error'})`)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

async function main() {
  const gate = gateArg as Gate | undefined
  if (gateArg !== undefined && gate !== 'coverage' && gate !== 'plaintext') {
    console.error('--gate takes coverage or plaintext')
    process.exit(1)
  }

  const exporters = scanExporters()
  if (CODE_ONLY) {
    console.log(`Exporters reading sensitive columns (${exporters.length}):`)
    for (const e of exporters) console.log(`  ${e.path}  [${e.columns.join(', ')}]`)
    return
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const missing = [!supabaseUrl && 'NEXT_PUBLIC_SUPABASE_URL', !supabaseSecretKey() && SECRET_KEY_VARS].filter(Boolean)
  if (missing.length) {
    console.error(`Missing env: ${missing.join(', ')}`)
    process.exit(1)
  }
  console.log(`Read-only scan of ${supabaseUrl!.includes(PRODUCTION_SUPABASE_REF) ? 'PRODUCTION' : 'a non-production project'}\n`)
  const db = supabaseServer()

  let fc: FieldCrypto | null = null
  if (VERIFY) {
    let ring
    try {
      ring = loadMasterKeyring()
    } catch {
      ring = null
    }
    if (!ring) {
      console.error('--verify needs FIELD_CRYPTO_MASTER_KEY and FIELD_CRYPTO_KEY_ID.')
      process.exit(1)
    }
    // Read-only: a store whose insert refuses, so verifying never creates a key.
    const real = supabaseDekStore(db)
    fc = new FieldCrypto(ring, { listKeys: (t) => real.listKeys(t), insertKey: async () => 'conflict' })
  }

  // Each tenant's active DEK id, for the stale-key count. Ids and dates only:
  // the wrapped keys are not read.
  const keyRows = await pageAll<{ tenant_id: string; key_id: string; retired_at: string | null }>(
    (from, to) => db.from('tenant_data_keys').select('tenant_id, key_id, retired_at').order('created_at', { ascending: true }).range(from, to),
    'tenant_data_keys',
  )
  const activeDek = new Map<string, string>()
  for (const k of keyRows) if (!k.retired_at) activeDek.set(k.tenant_id, k.key_id)

  const tables: ColumnCoverage[] = []
  for (const t of SENSITIVE_TABLES) {
    const rows = await pageAll<ShadowRow>(
      (from, to) => db.from(t.table).select(shadowSelect(t)).order(t.idColumn, { ascending: true }).range(from, to),
      t.table,
    )
    const mismatches = new Map<string, number>()
    if (fc) {
      for (const row of rows) {
        const tenantId = rowTenantId(t, row)
        for (const f of t.fields) {
          const enc = row[encColumn(f.column)]
          const plain = encodeFieldValue(f, row[f.column])
          if (typeof enc !== 'string' || plain === null) continue
          let ok = false
          try {
            ok = !!tenantId && (await fc.decrypt({ tenantId, table: t.table, column: f.column, rowId: row[t.idColumn] as string }, enc)) === plain
          } catch {
            ok = false
          }
          if (!ok) mismatches.set(f.column, (mismatches.get(f.column) ?? 0) + 1)
        }
      }
    }
    const activeKeyOf = (row: Record<string, unknown>) => {
      const tenantId = rowTenantId(t, row as ShadowRow)
      return tenantId ? activeDek.get(tenantId) : undefined
    }
    tables.push(...tableCoverage(t, rows as Record<string, unknown>[], fc ? mismatches : undefined, activeKeyOf))
  }

  const audit = await pageAll<{ old_data: unknown; new_data: unknown }>(
    (from, to) =>
      db
        .from('audit_log')
        .select('old_data, new_data')
        .in('table_name', SENSITIVE_TABLES.map((t) => t.table))
        .order('changed_at', { ascending: true })
        .range(from, to),
    'audit_log',
  )
  const archive = await pageAll<{ snapshot: unknown }>(
    (from, to) => db.from('deletion_archive').select('snapshot').order('deleted_at', { ascending: true }).range(from, to),
    'deletion_archive',
  )
  const agreementRows = await pageAll<{ prefill: unknown }>(
    (from, to) => db.from('agreements').select('prefill').not('prefill', 'is', null).order('id', { ascending: true }).range(from, to),
    'agreements',
  )
  const recipientRows = await pageAll<{ signer_values: unknown }>(
    (from, to) =>
      db.from('agreement_recipients').select('signer_values').not('signer_values', 'is', null).order('id', { ascending: true }).range(from, to),
    'agreement_recipients',
  )
  const tallyAgreements = (values: unknown[]) => ({
    rows: values.length,
    plaintextRows: values.filter((v) => agreementHoldsPlaintext(v)).length,
  })
  const tally = (values: unknown[]) => {
    let plaintextRows = 0
    let ciphertextRows = 0
    for (const v of values) {
      const c = countSensitiveKeys(v)
      if (c.plaintext.size) plaintextRows++
      if (c.ciphertext.size) ciphertextRows++
    }
    return { rows: values.length, plaintextRows, ciphertextRows }
  }

  const report: ScanReport = {
    tables,
    auditLog: tally(audit.map((r) => [r.old_data, r.new_data])),
    deletionArchive: tally(archive.map((r) => r.snapshot)),
    agreements: tallyAgreements(agreementRows.map((r) => r.prefill)),
    agreementRecipients: tallyAgreements(recipientRows.map((r) => r.signer_values)),
    exporters,
  }

  console.log(
    'Tables (plaintext / encrypted / missing ciphertext / orphan ciphertext / missing index / retired key' +
      (fc ? ' / mismatched' : '') +
      '):',
  )
  for (const c of report.tables) {
    console.log(
      `  ${`${c.table}.${c.column}`.padEnd(52)} ${String(c.plaintext).padStart(6)} ${String(c.encrypted).padStart(6)} ` +
        `${String(c.missingEnc).padStart(6)} ${String(c.orphanEnc).padStart(6)} ${String(c.missingBidx).padStart(6)} ` +
        `${String(c.staleKey).padStart(6)}` +
        (fc ? ` ${String(c.mismatched).padStart(6)}` : ''),
    )
  }
  console.log(`\naudit_log: ${report.auditLog.rows} row(s) for these tables; ${report.auditLog.plaintextRows} hold sensitive plaintext, ${report.auditLog.ciphertextRows} hold ciphertext`)
  console.log(`deletion_archive: ${report.deletionArchive.rows} snapshot(s); ${report.deletionArchive.plaintextRows} hold sensitive plaintext, ${report.deletionArchive.ciphertextRows} hold ciphertext`)
  console.log(`agreements.prefill: ${report.agreements.rows} with a prefill; ${report.agreements.plaintextRows} hold guardian or emergency-contact values`)
  console.log(
    `agreement_recipients.signer_values: ${report.agreementRecipients.rows} with values; ${report.agreementRecipients.plaintextRows} hold guardian or emergency-contact values`,
  )
  console.log(`\nExporters reading sensitive columns (${exporters.length}):`)
  for (const e of exporters) console.log(`  ${e.path}  [${e.columns.join(', ')}]`)

  if (gate) {
    const failures = gateFailures(report, gate)
    if (failures.length) {
      console.error(`\nGate "${gate}" FAILED:`)
      for (const f of failures) console.error(`  - ${f}`)
      process.exit(2)
    }
    console.log(`\nGate "${gate}" passed.`)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : 'scan failed')
  process.exit(1)
})
