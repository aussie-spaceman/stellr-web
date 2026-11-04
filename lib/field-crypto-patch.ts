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
}

/** Encrypt the given rows' sensitive columns. Errors per row are counted, not thrown. */
export async function syncShadowRows(
  db: SupabaseClient,
  crypto: FieldCrypto,
  tableName: SensitiveTableName,
  ids: readonly string[],
): Promise<ShadowSyncResult> {
  const t = sensitiveTable(tableName)
  const result: ShadowSyncResult = { updated: 0, unchanged: 0, skipped: 0, failed: 0 }
  const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))]
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100)
    const { data, error } = await db.from(t.table).select(shadowSelect(t)).in(t.idColumn, batch)
    if (error) {
      result.failed += batch.length
      continue
    }
    for (const row of (data ?? []) as unknown as ShadowRow[]) {
      const tenantId = rowTenantId(t, row)
      if (!tenantId) {
        result.skipped++
        continue
      }
      try {
        const patch = await buildShadowPatch(crypto, t, row, tenantId)
        if (Object.keys(patch).length === 0) {
          result.unchanged++
          continue
        }
        const { error: upErr } = await db.from(t.table).update(patch).eq(t.idColumn, row[t.idColumn] as string)
        if (upErr) result.failed++
        else result.updated++
      } catch {
        result.failed++
      }
    }
  }
  return result
}

