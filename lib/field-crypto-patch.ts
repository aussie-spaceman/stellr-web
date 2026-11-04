import type { SupabaseClient } from '@supabase/supabase-js'
import { FieldCrypto, FieldCryptoError, fieldKeyId, type FieldContext } from '@/lib/field-crypto'
import {
  bidxColumn,
  encColumn,
  sensitiveTable,
  type SensitiveField,
  type SensitiveTable,
  type SensitiveTableName,
} from '@/lib/field-crypto-fields'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// The shadow patch builder for field encryption (multi-tenancy plan S4):
// given a row's plaintext and its current *_enc / *_bidx values, the columns
// to write. Shared by the app's shadow dual-write (lib/field-crypto-shadow.ts)
// and scripts/backfill-field-crypto.ts. No Next.js imports, so scripts can use
// it directly.

export type ShadowRow = Record<string, unknown> & { registrations?: unknown }

/** The plaintext as stored for encryption: null for empty (nothing to protect). */
export function encodeFieldValue(field: SensitiveField, raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (field.kind === 'text_array') {
    if (!Array.isArray(raw)) return null
    const items = raw.filter((v): v is string => typeof v === 'string')
    return items.length ? JSON.stringify(items) : null
  }
  if (typeof raw !== 'string') return null
  return raw.length ? raw : null
}

/** Columns to select for a shadow sync of `t`. */
export function shadowSelect(t: SensitiveTable): string {
  const cols = [t.idColumn]
  for (const f of t.fields) {
    cols.push(f.column, encColumn(f.column))
    if (f.blindIndex) cols.push(bidxColumn(f.column))
  }
  if (t.tenantFrom === 'registration') cols.push('registrations(tenant_id)')
  return [...new Set(cols)].join(', ')
}

/** The tenant a row's values are encrypted for, or null when it can't be known. */
export function rowTenantId(t: SensitiveTable, row: ShadowRow): string | null {
  if (t.tenantFrom === 'platform') return STELLR_TENANT_ID
  const reg = Array.isArray(row.registrations) ? row.registrations[0] : row.registrations
  const id = reg && typeof reg === 'object' ? (reg as { tenant_id?: unknown }).tenant_id : null
  return typeof id === 'string' && id ? id : null
}

/**
 * The `*_enc` / `*_bidx` values that bring `row` in line with its plaintext.
 * Only columns that need to change are returned (an empty object means the
 * row is current), so a write that didn't touch a sensitive field costs no
 * update. A ciphertext is kept when it opens to the current plaintext under
 * the tenant's active DEK; anything else (missing, stale, written under a
 * retired DEK, or unreadable) is rewritten.
 */
export async function buildShadowPatch(
  crypto: FieldCrypto,
  t: SensitiveTable,
  row: ShadowRow,
  tenantId: string,
): Promise<Record<string, string | null>> {
  const rowId = row[t.idColumn]
  if (typeof rowId !== 'string' || !rowId) throw new FieldCryptoError('input')
  const patch: Record<string, string | null> = {}
  const active = await crypto.activeKey(tenantId)
  for (const f of t.fields) {
    const ctx: FieldContext = { tenantId, table: t.table, column: f.column, rowId }
    const plain = encodeFieldValue(f, row[f.column])
    const enc = encColumn(f.column)
    const existing = typeof row[enc] === 'string' ? (row[enc] as string) : null

    if (plain === null) {
      if (existing !== null) patch[enc] = null
    } else {
      let current = false
      if (existing !== null) {
        try {
          current = fieldKeyId(existing) === active.keyId && (await crypto.decrypt(ctx, existing)) === plain
        } catch {
          current = false
        }
      }
      if (!current) patch[enc] = await crypto.encrypt(ctx, plain)
    }

    if (f.blindIndex) {
      const bidx = bidxColumn(f.column)
      const want =
        plain === null ? null : await crypto.blindIndex({ tenantId, table: t.table, column: f.column }, plain, f.blindIndex)
      const have = typeof row[bidx] === 'string' ? (row[bidx] as string) : null
      if (want !== have) patch[bidx] = want
    }
  }
  return patch
}

export interface ShadowSyncResult {
  updated: number
  unchanged: number
  skipped: number
  failed: number
  /** The plaintext kept changing under us; that writer's own sync covers it. */
  raced: number
}

export type ShadowApplyOutcome = 'updated' | 'raced' | 'error'

/** A PostgREST text[] literal for an equality filter, or null if `raw` is not a string array. */
export function pgTextArrayLiteral(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null
  const items: string[] = []
  for (const v of raw) {
    if (v === null) items.push('NULL')
    else if (typeof v === 'string') items.push(`"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    else return null
  }
  return `{${items.join(',')}}`
}

/**
 * Write `patch` to `row`, but only while every sensitive plaintext column still
 * holds the value the patch was built from (compare-and-set). Without this, a
 * sync that read an old value and stalled could land after a newer sync and
 * write back the ciphertext of a value that has since been changed or erased
 * (a member clearing their health notes, the medical retention job, the
 * under-13 erase). 'raced' means no row matched: re-read and rebuild.
 */
export async function applyShadowPatch(
  db: SupabaseClient,
  t: SensitiveTable,
  row: ShadowRow,
  patch: Record<string, string | null>,
): Promise<ShadowApplyOutcome> {
  const rowId = row[t.idColumn]
  if (typeof rowId !== 'string' || !rowId) return 'error'
  let q = db.from(t.table).update(patch).eq(t.idColumn, rowId)
  for (const f of t.fields) {
    const raw = row[f.column]
    if (raw === null) {
      q = q.is(f.column, null)
    } else if (f.kind === 'text_array') {
      const literal = pgTextArrayLiteral(raw)
      if (literal === null) return 'error'
      q = q.filter(f.column, 'eq', literal)
    } else if (typeof raw === 'string') {
      q = q.eq(f.column, raw)
    } else {
      // Not selected, or an unexpected type: no safe guard, so no write.
      return 'error'
    }
  }
  const { data, error } = await q.select(t.idColumn)
  if (error) return 'error'
  return Array.isArray(data) && data.length > 0 ? 'updated' : 'raced'
}

/** Attempts per row before a row whose plaintext keeps changing is left to its writer's own sync. */
const MAX_ATTEMPTS = 3

type RowOutcome = 'updated' | 'unchanged' | 'skipped' | 'failed' | 'raced'

async function syncOneRow(db: SupabaseClient, crypto: FieldCrypto, t: SensitiveTable, row: ShadowRow): Promise<RowOutcome> {
  const tenantId = rowTenantId(t, row)
  if (!tenantId) return 'skipped'
  try {
    const patch = await buildShadowPatch(crypto, t, row, tenantId)
    if (Object.keys(patch).length === 0) return 'unchanged'
    const outcome = await applyShadowPatch(db, t, row, patch)
    return outcome === 'error' ? 'failed' : outcome
  } catch {
    return 'failed'
  }
}

/** Encrypt the given rows' sensitive columns. Errors per row are counted, not thrown. */
export async function syncShadowRows(
  db: SupabaseClient,
  crypto: FieldCrypto,
  tableName: SensitiveTableName,
  ids: readonly string[],
): Promise<ShadowSyncResult> {
  const t = sensitiveTable(tableName)
  const result: ShadowSyncResult = { updated: 0, unchanged: 0, skipped: 0, failed: 0, raced: 0 }
  const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))]
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100)
    const { data, error } = await db.from(t.table).select(shadowSelect(t)).in(t.idColumn, batch)
    if (error) {
      result.failed += batch.length
      continue
    }
    for (const first of (data ?? []) as unknown as ShadowRow[]) {
      let row: ShadowRow | null = first
      for (let attempt = 1; row; attempt++) {
        const outcome = await syncOneRow(db, crypto, t, row)
        if (outcome !== 'raced') {
          result[outcome]++
          break
        }
        if (attempt >= MAX_ATTEMPTS) {
          result.raced++
          break
        }
        // The plaintext changed between our read and our write: read it again
        // and rebuild. A row that has gone away needs nothing.
        const rowId = row[t.idColumn] as string
        const { data: again, error: reErr }: { data: unknown; error: unknown } = await db
          .from(t.table)
          .select(shadowSelect(t))
          .in(t.idColumn, [rowId])
        if (reErr) {
          result.failed++
          break
        }
        row = ((again ?? []) as unknown as ShadowRow[])[0] ?? null
        if (!row) result.unchanged++
      }
    }
  }
  return result
}
