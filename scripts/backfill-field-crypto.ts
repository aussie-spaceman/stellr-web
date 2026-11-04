/**
 * Fill the S4 shadow ciphertext columns (*_enc, *_bidx) for existing rows, and
 * run the key-rotation steps. docs/FIELD-CRYPTO.md is the runbook.
 *
 *   npx tsx scripts/backfill-field-crypto.ts                        # dry run (default): counts, writes nothing
 *   npx tsx scripts/backfill-field-crypto.ts --apply                # write to the project in .env.local
 *   npx tsx scripts/backfill-field-crypto.ts --apply --production   # owner only: write to production
 *   npx tsx scripts/backfill-field-crypto.ts --table participants   # one table (participants | members | member_pending_consent)
 *   npx tsx scripts/backfill-field-crypto.ts --rewrap [--apply]     # master-key rotation: re-wrap every DEK under FIELD_CRYPTO_KEY_ID
 *   npx tsx scripts/backfill-field-crypto.ts --rotate-dek <tenant-uuid> [--apply]
 *                                                                   # DEK rotation: retire the tenant's active DEK, then re-encrypt
 *
 * Idempotent: a value whose ciphertext already opens to the current plaintext
 * under the tenant's active DEK is left alone, so re-running costs reads only.
 * Works whatever FIELD_CRYPTO_MODE is (the backfill is how shadow mode starts
 * complete), but needs FIELD_CRYPTO_MASTER_KEY + FIELD_CRYPTO_KEY_ID.
 *
 * A dry run never writes, not even a first data key: if a tenant has none yet
 * it says so and works with a throwaway key held in memory.
 *
 * Prints counts only — never a value, a ciphertext or key material.
 *
 * Prerequisites (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY,
 * FIELD_CRYPTO_MASTER_KEY, FIELD_CRYPTO_KEY_ID (and the _PREVIOUS_ pair during
 * a master-key rotation). Migration 20261104400000 applied.
 */
import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import { supabaseServer } from '../lib/supabase'
import { SECRET_KEY_VARS, supabaseSecretKey } from '../lib/supabase-keys'
import {
  FieldCrypto,
  FieldCryptoError,
  loadMasterKeyring,
  rewrapDek,
  wrappedMasterId,
  type DekRow,
  type DekStore,
} from '../lib/field-crypto'
import { supabaseDekStore } from '../lib/field-crypto-store'
import { buildShadowPatch, rowTenantId, shadowSelect, type ShadowRow } from '../lib/field-crypto-patch'
import { SENSITIVE_TABLES, type SensitiveTableName } from '../lib/field-crypto-fields'
import { PRODUCTION_SUPABASE_REF } from './production-guard.mjs'

// Static imports above read no env at module scope (lib/supabase and
// lib/field-crypto read it when called), so loading .env.local here is safe.
const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config(fs.existsSync(envPath) ? { path: envPath } : {})

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const PRODUCTION_OK = argv.includes('--production')
const REWRAP = argv.includes('--rewrap')
const argAfter = (flag: string) => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const ROTATE_TENANT = argAfter('--rotate-dek')
const ONLY_TABLE = argAfter('--table')
const PAGE = 500
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A store that reads the real table but keeps new keys in memory (dry runs). */
function dryRunStore(real: DekStore, created: Set<string>): DekStore {
  const local: DekRow[] = []
  return {
    async listKeys(t) {
      return [...(await real.listKeys(t)), ...local.filter((r) => r.tenant_id === t)]
    },
    async insertKey(row) {
      created.add(row.tenant_id)
      local.push({ ...row, created_at: new Date().toISOString(), retired_at: null })
      return 'ok'
    },
  }
}

async function rewrapAll(store: DekStore, db: ReturnType<typeof supabaseServer>) {
  const ring = loadMasterKeyring()!
  const { data, error } = await db.from('tenant_data_keys').select('tenant_id, key_id, master_key_id, wrapped_dek')
  if (error) throw new Error(`Cannot read tenant_data_keys (${error.code})`)
  let stale = 0
  for (const row of (data ?? []) as DekRow[]) {
    if (wrappedMasterId(row.wrapped_dek) === ring.current.id) continue
    stale++
    const wrapped = rewrapDek(ring, row.tenant_id, row.key_id, row.wrapped_dek)
    if (APPLY) await store.updateWrapped!(row.tenant_id, row.key_id, ring.current.id, wrapped)
  }
  console.log(`${(data ?? []).length} data key(s); ${stale} not under ${ring.current.id}${APPLY ? ' — re-wrapped' : ' — would re-wrap'}.`)
  if (stale && APPLY) console.log('Next: confirm the app reads with the new key, then remove FIELD_CRYPTO_PREVIOUS_* (docs/FIELD-CRYPTO.md).')
}

async function rotateDek(store: DekStore, tenantId: string) {
  const rows = await store.listKeys(tenantId)
  const active = rows.find((r) => !r.retired_at)
  if (!active) {
    console.log(`Tenant has no active data key; the next write or backfill creates one.`)
    return
  }
  if (!APPLY) {
    console.log(`Would retire data key ${active.key_id} for the tenant and create a new one, then re-encrypt.`)
    return
  }
  await store.retireKey!(tenantId, active.key_id, new Date().toISOString())
  console.log(`Retired data key ${active.key_id}. A new key is created on the first encryption below.`)
}

async function backfillTable(fc: FieldCrypto, db: ReturnType<typeof supabaseServer>, name: SensitiveTableName) {
  const t = SENSITIVE_TABLES.find((x) => x.table === name)!
  const counts = { scanned: 0, current: 0, changed: 0, columns: 0, noTenant: 0, errors: 0 }
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(t.table)
      .select(shadowSelect(t))
      .order(t.idColumn, { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Cannot read ${t.table} (${error.code}). Is migration 20261104400000 applied?`)
    const rows = (data ?? []) as unknown as ShadowRow[]
    for (const row of rows) {
      counts.scanned++
      const tenantId = rowTenantId(t, row)
      if (!tenantId) {
        counts.noTenant++
        continue
      }
      try {
        const patch = await buildShadowPatch(fc, t, row, tenantId)
        const n = Object.keys(patch).length
        if (n === 0) {
          counts.current++
          continue
        }
        counts.changed++
        counts.columns += n
        if (APPLY) {
          const { error: upErr } = await db.from(t.table).update(patch).eq(t.idColumn, row[t.idColumn] as string)
          if (upErr) counts.errors++
        }
      } catch (e) {
        counts.errors++
        // A key problem (a DEK that will not unwrap, the store unreachable)
        // fails every row: stop rather than count. A bad row is counted.
        if (e instanceof FieldCryptoError && e.code !== 'input') throw e
      }
    }
    if (rows.length < PAGE) break
  }
  console.log(
    `  ${t.table.padEnd(24)} scanned ${counts.scanned}, current ${counts.current}, ` +
      `${APPLY ? 'updated' : 'to update'} ${counts.changed} (${counts.columns} column value(s)), ` +
      `no tenant ${counts.noTenant}, errors ${counts.errors}`,
  )
  return counts
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const missing = [!supabaseUrl && 'NEXT_PUBLIC_SUPABASE_URL', !supabaseSecretKey() && SECRET_KEY_VARS].filter(Boolean)
  if (missing.length) {
    console.error(`Missing env: ${missing.join(', ')}`)
    process.exit(1)
  }
  let ring
  try {
    ring = loadMasterKeyring()
  } catch {
    console.error('FIELD_CRYPTO_MASTER_KEY / FIELD_CRYPTO_KEY_ID are malformed (32 bytes, base64; id [A-Za-z0-9_-]{1,32}).')
    process.exit(1)
  }
  if (!ring) {
    console.error('FIELD_CRYPTO_MASTER_KEY and FIELD_CRYPTO_KEY_ID are not set: field encryption is inert, nothing to do.')
    process.exit(1)
  }
  if (ONLY_TABLE && !SENSITIVE_TABLES.some((t) => t.table === ONLY_TABLE)) {
    console.error(`--table must be one of: ${SENSITIVE_TABLES.map((t) => t.table).join(', ')}`)
    process.exit(1)
  }
  if (ROTATE_TENANT !== undefined && !UUID.test(ROTATE_TENANT)) {
    console.error('--rotate-dek takes a tenant id (uuid).')
    process.exit(1)
  }
  const isProduction = supabaseUrl!.includes(PRODUCTION_SUPABASE_REF)
  if (APPLY && isProduction && !PRODUCTION_OK) {
    console.error('Refusing to write to PRODUCTION without --production (an owner action: docs/FIELD-CRYPTO.md).')
    process.exit(1)
  }
  console.log(
    `${APPLY ? 'APPLY' : 'DRY RUN'} against ${isProduction ? 'PRODUCTION' : 'a non-production project'} ` +
      `(master key ${ring.current.id}${ring.previous ? `, previous ${ring.previous.id}` : ''})\n`,
  )

  const db = supabaseServer()
  const realStore = supabaseDekStore(db)

  if (REWRAP) {
    await rewrapAll(realStore, db)
    return
  }
  if (ROTATE_TENANT) await rotateDek(realStore, ROTATE_TENANT)

  const createdDryRun = new Set<string>()
  const store = APPLY ? realStore : dryRunStore(realStore, createdDryRun)
  const fc = new FieldCrypto(ring, store, { cacheTtlMs: 60 * 60 * 1000 })

  let errors = 0
  for (const t of SENSITIVE_TABLES) {
    if (ONLY_TABLE && t.table !== ONLY_TABLE) continue
    errors += (await backfillTable(fc, db, t.table)).errors
  }
  if (createdDryRun.size) console.log(`\n${createdDryRun.size} tenant(s) have no data key yet; --apply creates one each.`)
  if (!APPLY) console.log('\nDry run: nothing written. Re-run with --apply to write.')
  if (errors) {
    console.error(`\n${errors} row(s) failed. Re-run to retry; scripts/scan-plaintext-sensitive.ts --verify shows what is left.`)
    process.exit(1)
  }
}

main().catch((err) => {
  // Messages here are ours or FieldCryptoError's fixed text — no values, no keys.
  console.error(err instanceof Error ? err.message : 'backfill failed')
  process.exit(1)
})
