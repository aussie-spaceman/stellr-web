import { createHash } from 'node:crypto'
import { FieldCrypto, FieldCryptoError, fieldCryptoMode, loadMasterKeyring } from '@/lib/field-crypto'
import { supabaseDekStore } from '@/lib/field-crypto-store'
import { syncShadowRows } from '@/lib/field-crypto-patch'
import type { SensitiveTableName } from '@/lib/field-crypto-fields'
import { runAfterResponse } from '@/lib/after-response'
import { supabaseServer } from '@/lib/supabase'

// Shadow dual-write for field encryption (multi-tenancy plan S4).
//
// A write site that saves a sensitive column adds ONE line after its own write
// has succeeded:
//
//   shadowSyncFields('participants', [participantId])
//
// That call returns immediately. With FIELD_CRYPTO_MODE off (the default) or no
// master key it does nothing at all. In shadow mode it schedules, after the
// response, a re-read of those rows' plaintext and writes the matching
// `*_enc` / `*_bidx` columns. It never throws, never rejects and never delays
// or fails the caller's write: every error is caught and logged by code only
// (no values, no key material). Reads stay on the plaintext.
//
// Re-reading rather than taking the values from the caller keeps each call
// site to one line and makes the result right whichever columns changed. The
// shadow UPDATE is a compare-and-set on the plaintext it was built from
// (applyShadowPatch): if the plaintext changed after our read, nothing is
// written and the row is re-read, so a stale sync can never land the
// ciphertext of a value that was since changed or erased.
// scripts/backfill-field-crypto.ts runs the same patch builder over every row,
// and scripts/scan-plaintext-sensitive.ts reports any drift.

let cached: { crypto: FieldCrypto; fingerprint: string } | null = null

function envFingerprint(): string {
  // Rebuild the service if the keys change (tests; a rotation picked up by a
  // warm instance). A digest, so the key itself is never held as a cache key.
  const e = process.env
  return createHash('sha256')
    .update(JSON.stringify([e.FIELD_CRYPTO_KEY_ID, e.FIELD_CRYPTO_MASTER_KEY, e.FIELD_CRYPTO_PREVIOUS_KEY_ID, e.FIELD_CRYPTO_PREVIOUS_MASTER_KEY]))
    .digest('hex')
}

/** The process-wide service, or null when inert or misconfigured. Never throws. */
export async function appFieldCrypto(): Promise<FieldCrypto | null> {
  let ring
  try {
    ring = loadMasterKeyring()
  } catch {
    return null
  }
  if (!ring) return null
  const fp = envFingerprint()
  if (cached && cached.fingerprint === fp) return cached.crypto
  cached = { crypto: new FieldCrypto(ring, supabaseDekStore(supabaseServer())), fingerprint: fp }
  return cached.crypto
}

/** True when write sites should dual-write (shadow or read mode, key present). */
export function shadowWritesEnabled(): boolean {
  if (fieldCryptoMode() === 'off') return false
  try {
    return loadMasterKeyring() !== null
  } catch {
    return false
  }
}

function logSkip(table: string, reason: string) {
  console.warn(`[field-crypto] shadow write skipped for ${table} (${reason})`)
}

/**
 * After a successful write of sensitive columns on `table`, schedule the
 * ciphertext dual-write for those rows. Synchronous, inert by default, and
 * unable to throw or fail the caller.
 */
export function shadowSyncFields(table: SensitiveTableName, ids: ReadonlyArray<string | null | undefined>): void {
  try {
    if (!shadowWritesEnabled()) return
    const list = ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
    if (list.length === 0) return
    // runAfterResponse keeps the instance alive until the task settles and
    // falls back to a detached run outside a request (scripts, tests).
    runAfterResponse('field-crypto', () => runShadow(table, list))
  } catch {
    // Never let the shadow path reach the caller.
  }
}

async function runShadow(table: SensitiveTableName, ids: string[]): Promise<void> {
  try {
    const crypto = await appFieldCrypto()
    if (!crypto) return logSkip(table, 'config')
    const r = await syncShadowRows(supabaseServer(), crypto, table, ids)
    if (r.failed || r.skipped || r.raced) {
      logSkip(table, `${r.failed} failed, ${r.skipped} without a tenant, ${r.raced} still changing`)
    }
  } catch (e) {
    logSkip(table, e instanceof FieldCryptoError ? e.code : 'error')
  }
}
