import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { GCM_KEY_BYTES, GcmOpenError, openGcm, sealGcm } from '@/lib/esign/backup-crypto'

// Application-level field encryption (multi-tenancy plan S4). Runbook and
// column inventory: docs/FIELD-CRYPTO.md.
//
// Envelope encryption, three layers:
//
//   master key   FIELD_CRYPTO_MASTER_KEY (base64, 32 bytes) + FIELD_CRYPTO_KEY_ID,
//                in a Vercel secret and escrowed offline by the owner. A second
//                pair, FIELD_CRYPTO_PREVIOUS_MASTER_KEY / _PREVIOUS_KEY_ID, keeps
//                the outgoing key readable during a rotation. It only ever
//                wraps data keys; it never touches a field.
//   data key     one random 32-byte DEK per tenant (more after a DEK rotation),
//                stored wrapped in public.tenant_data_keys:
//                  wk1.<master key id>.<base64url(IV | tag | ciphertext)>
//                The wrap's AAD binds the tenant id and the DEK's own id, so a
//                wrapped key copied onto another tenant's row will not open.
//   field        AES-256-GCM under the tenant's DEK:
//                  sf1.<DEK id>.<base64url(IV | tag | ciphertext)>
//                AAD = ["sf1", tenant id, table, column, row id, DEK id], so a
//                ciphertext moved to another row, column, table or tenant
//                fails to open instead of decrypting somewhere it doesn't belong.
//
// Blind indexes (equality lookup without decrypting): HMAC-SHA256 over the
// normalised value, under a key derived from the DEK with HKDF and bound to
// tenant, table and column — never the DEK itself, and a different key for
// every column, so the same email has unlinkable indexes in two columns.
//                  bi1.<DEK id>.<base64url(HMAC)>
// Compare them with blindIndexEquals (constant time).
//
// Modes (FIELD_CRYPTO_MODE): off (default) | shadow | read. With the master key
// unset, or the mode off, nothing here runs: lib/field-crypto-shadow.ts returns
// before touching the database. In S4's shadow mode the app writes ciphertext
// alongside the plaintext and still reads only the plaintext; `read` is
// reserved for the cut-over and switches no read in this change.
//
// Errors are FieldCryptoError with a fixed message per code: never key
// material, plaintext, ciphertext or an underlying library message.

export type FieldCryptoMode = 'off' | 'shadow' | 'read'
export const FIELD_CRYPTO_MODES: readonly FieldCryptoMode[] = ['off', 'shadow', 'read']

export const FIELD_VERSION = 'sf1'
export const WRAP_VERSION = 'wk1'
export const BIDX_VERSION = 'bi1'

/** Key ids are short, printable and safe inside the dotted formats above. */
export const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
const IDENT = /^[a-z][a-z0-9_]{0,62}$/
const B64URL = /^[A-Za-z0-9_-]+$/

export type FieldCryptoErrorCode = 'config' | 'format' | 'auth' | 'no_key' | 'store' | 'input'

const MESSAGES: Record<FieldCryptoErrorCode, string> = {
  config: 'Field encryption is misconfigured',
  format: 'Not a recognised field-encryption value',
  auth: 'Encrypted value could not be authenticated',
  no_key: 'The key for this value is not available',
  store: 'The data-key store could not be read or written',
  input: 'Invalid field-encryption input',
}

export class FieldCryptoError extends Error {
  readonly code: FieldCryptoErrorCode
  constructor(code: FieldCryptoErrorCode) {
    super(MESSAGES[code])
    this.name = 'FieldCryptoError'
    this.code = code
  }
}

type Env = Record<string, string | undefined>

// ── Configuration ───────────────────────────────────────────────────────────

/** The configured mode. Anything unrecognised is 'off' (fail inert). */
export function fieldCryptoMode(env: Env = process.env): FieldCryptoMode {
  const raw = (env.FIELD_CRYPTO_MODE ?? '').trim().toLowerCase()
  return (FIELD_CRYPTO_MODES as readonly string[]).includes(raw) ? (raw as FieldCryptoMode) : 'off'
}

export interface MasterKey {
  id: string
  key: Buffer
}

export interface MasterKeyring {
  current: MasterKey
  previous?: MasterKey
}

function parseKey(raw: string | undefined, id: string | undefined): MasterKey | null {
  if (!raw && !id) return null
  if (!raw || !id) throw new FieldCryptoError('config')
  const keyId = id.trim()
  if (!KEY_ID_PATTERN.test(keyId)) throw new FieldCryptoError('config')
  const trimmed = raw.trim()
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) throw new FieldCryptoError('config')
  const key = Buffer.from(trimmed, 'base64')
  if (key.length !== GCM_KEY_BYTES) throw new FieldCryptoError('config')
  return { id: keyId, key }
}

/**
 * The master keyring from the environment, or null when no master key is set
 * (field encryption inert). Throws FieldCryptoError('config') when a key is
 * set but malformed: wrong length, not base64, a key without an id, or the
 * previous key sharing the current key's id.
 */
export function loadMasterKeyring(env: Env = process.env): MasterKeyring | null {
  const current = parseKey(env.FIELD_CRYPTO_MASTER_KEY, env.FIELD_CRYPTO_KEY_ID)
  const previous = parseKey(env.FIELD_CRYPTO_PREVIOUS_MASTER_KEY, env.FIELD_CRYPTO_PREVIOUS_KEY_ID)
  if (!current) {
    if (previous) throw new FieldCryptoError('config')
    return null
  }
  if (previous && previous.id === current.id) throw new FieldCryptoError('config')
  return previous ? { current, previous } : { current }
}

/** True only when the mode is not off and a well-formed master key is set. Never throws. */
export function fieldCryptoActive(env: Env = process.env): boolean {
  if (fieldCryptoMode(env) === 'off') return false
  try {
    return loadMasterKeyring(env) !== null
  } catch {
    return false
  }
}

// ── Encoding helpers ────────────────────────────────────────────────────────

const b64url = (buf: Uint8Array) => Buffer.from(buf).toString('base64url')

function fromB64url(s: string): Buffer {
  if (!B64URL.test(s)) throw new FieldCryptoError('format')
  return Buffer.from(s, 'base64url')
}

function aad(parts: string[]): Buffer {
  return Buffer.from(JSON.stringify(parts), 'utf8')
}

function requireId(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) throw new FieldCryptoError('input')
  return value
}

function requireIdent(value: string): string {
  if (typeof value !== 'string' || !IDENT.test(value)) throw new FieldCryptoError('input')
  return value
}

function requireKeyId(value: string): string {
  if (typeof value !== 'string' || !KEY_ID_PATTERN.test(value)) throw new FieldCryptoError('input')
  return value
}

interface Dotted {
  version: string
  keyId: string
  body: Buffer
}

function parseDotted(value: string, version: string): Dotted {
  if (typeof value !== 'string') throw new FieldCryptoError('format')
  const parts = value.split('.')
  if (parts.length !== 3 || parts[0] !== version || !KEY_ID_PATTERN.test(parts[1])) throw new FieldCryptoError('format')
  return { version: parts[0], keyId: parts[1], body: fromB64url(parts[2]) }
}

// ── Data keys (DEKs) ────────────────────────────────────────────────────────

export interface DataKey {
  keyId: string
  key: Buffer
}

export function generateDek(): Buffer {
  return randomBytes(GCM_KEY_BYTES)
}

/** A fresh DEK id: d<yyyymmdd>-<8 random base64url chars>. */
export function newDekId(now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '')
  return `d${day}-${randomBytes(6).toString('base64url')}`
}

const wrapAad = (tenantId: string, dekId: string, masterId: string) => aad([WRAP_VERSION, tenantId, dekId, masterId])

/** Wrap a tenant's DEK under a master key. */
export function wrapDek(master: MasterKey, tenantId: string, dekId: string, dek: Uint8Array): string {
  requireId(tenantId)
  requireKeyId(dekId)
  if (dek.length !== GCM_KEY_BYTES) throw new FieldCryptoError('input')
  const sealed = sealGcm(master.key, dek, wrapAad(tenantId, dekId, master.id))
  return `${WRAP_VERSION}.${master.id}.${b64url(sealed)}`
}

/** The master key id a wrapped DEK was sealed under. */
export function wrappedMasterId(wrapped: string): string {
  return parseDotted(wrapped, WRAP_VERSION).keyId
}

/** Unwrap with whichever key in the ring the wrapped value names. */
export function unwrapDek(ring: MasterKeyring, tenantId: string, dekId: string, wrapped: string): Buffer {
  requireId(tenantId)
  requireKeyId(dekId)
  const { keyId, body } = parseDotted(wrapped, WRAP_VERSION)
  const master = ring.current.id === keyId ? ring.current : ring.previous?.id === keyId ? ring.previous : undefined
  if (!master) throw new FieldCryptoError('no_key')
  try {
    const dek = openGcm(master.key, body, wrapAad(tenantId, dekId, master.id))
    if (dek.length !== GCM_KEY_BYTES) throw new FieldCryptoError('auth')
    return dek
  } catch (e) {
    if (e instanceof FieldCryptoError) throw e
    if (e instanceof GcmOpenError) throw new FieldCryptoError('auth')
    throw new FieldCryptoError('auth')
  }
}

/** Re-wrap under the ring's current master key (master-key rotation). */
export function rewrapDek(ring: MasterKeyring, tenantId: string, dekId: string, wrapped: string): string {
  const dek = unwrapDek(ring, tenantId, dekId, wrapped)
  try {
    return wrapDek(ring.current, tenantId, dekId, dek)
  } finally {
    dek.fill(0)
  }
}

// ── Fields ──────────────────────────────────────────────────────────────────

export interface FieldContext {
  tenantId: string
  table: string
  column: string
  rowId: string
}

export type ColumnContext = Omit<FieldContext, 'rowId'>

function fieldAad(ctx: FieldContext, dekId: string): Buffer {
  return aad([FIELD_VERSION, requireId(ctx.tenantId), requireIdent(ctx.table), requireIdent(ctx.column), requireId(ctx.rowId), dekId])
}

/** Encrypt one value for one cell. */
export function encryptField(dek: DataKey, ctx: FieldContext, plaintext: string): string {
  if (typeof plaintext !== 'string') throw new FieldCryptoError('input')
  requireKeyId(dek.keyId)
  const sealed = sealGcm(dek.key, Buffer.from(plaintext, 'utf8'), fieldAad(ctx, dek.keyId))
  return `${FIELD_VERSION}.${dek.keyId}.${b64url(sealed)}`
}

/** The DEK id a field ciphertext was written under. */
export function fieldKeyId(ciphertext: string): string {
  return parseDotted(ciphertext, FIELD_VERSION).keyId
}

export function isFieldCiphertext(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    parseDotted(value, FIELD_VERSION)
    return true
  } catch {
    return false
  }
}

/**
 * Decrypt one cell. `keys` is the DEK itself or a lookup by DEK id (any of the
 * tenant's keys, retired ones included). Throws FieldCryptoError: 'format' for
 * a value that is not sf1, 'no_key' for an unknown DEK id, 'auth' for a wrong
 * key, a wrong context (tenant, table, column, row) or a tampered value.
 */
export function decryptField(
  keys: DataKey | ((keyId: string) => DataKey | undefined),
  ctx: FieldContext,
  ciphertext: string,
): string {
  const { keyId, body } = parseDotted(ciphertext, FIELD_VERSION)
  const dek = typeof keys === 'function' ? keys(keyId) : keys.keyId === keyId ? keys : undefined
  if (!dek) throw new FieldCryptoError('no_key')
  try {
    return openGcm(dek.key, body, fieldAad(ctx, keyId)).toString('utf8')
  } catch (e) {
    if (e instanceof FieldCryptoError) throw e
    throw new FieldCryptoError('auth')
  }
}

// ── Blind indexes ───────────────────────────────────────────────────────────

export type Normaliser = 'email' | 'phone' | 'text'

/** Canonical form for equality lookup. */
export function normaliseForIndex(value: string, normaliser: Normaliser): string {
  const v = value.normalize('NFKC').trim()
  switch (normaliser) {
    case 'email':
      return v.toLowerCase()
    case 'phone': {
      // Digits only, keeping a leading + so +61… and 61… stay distinct.
      const digits = v.replace(/[^0-9]/g, '')
      return v.startsWith('+') ? `+${digits}` : digits
    }
    case 'text':
      return v.toLowerCase().replace(/\s+/g, ' ')
  }
}

function blindIndexKey(dek: DataKey, ctx: ColumnContext): Buffer {
  const info = aad([BIDX_VERSION, requireId(ctx.tenantId), requireIdent(ctx.table), requireIdent(ctx.column), dek.keyId])
  return Buffer.from(hkdfSync('sha256', dek.key, Buffer.from('stellr-field-crypto/blind-index'), info, 32))
}

/**
 * The blind index of `value` for one column: stable for the same DEK and
 * normalised value, different for every tenant, column and DEK. Returns null
 * for a value that normalises to empty (nothing to look up).
 */
export function blindIndex(dek: DataKey, ctx: ColumnContext, value: string, normaliser: Normaliser): string | null {
  if (typeof value !== 'string') throw new FieldCryptoError('input')
  requireKeyId(dek.keyId)
  const canonical = normaliseForIndex(value, normaliser)
  if (!canonical) return null
  const key = blindIndexKey(dek, ctx)
  try {
    const mac = createHmac('sha256', key).update(canonical, 'utf8').digest()
    return `${BIDX_VERSION}.${dek.keyId}.${b64url(mac)}`
  } finally {
    key.fill(0)
  }
}

/** Constant-time equality for two blind indexes (or any two short strings). */
export function blindIndexEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  // timingSafeEqual needs equal lengths; compare against self to keep the
  // work constant, then fold the length check in.
  const same = ab.length === bb.length
  return timingSafeEqual(ab, same ? bb : ab) && same
}

// ── The data-key store and the service ──────────────────────────────────────

export interface DekRow {
  tenant_id: string
  key_id: string
  master_key_id: string
  wrapped_dek: string
  created_at: string
  retired_at: string | null
}

/** Persistence for wrapped DEKs (public.tenant_data_keys in the app). */
export interface DekStore {
  listKeys(tenantId: string): Promise<DekRow[]>
  /** 'conflict' when the tenant already has an active key (the partial unique index). */
  insertKey(row: Omit<DekRow, 'created_at' | 'retired_at'>): Promise<'ok' | 'conflict'>
  retireKey?(tenantId: string, keyId: string, at: string): Promise<void>
  updateWrapped?(tenantId: string, keyId: string, masterKeyId: string, wrapped: string): Promise<void>
}

/** Default for FieldCryptoOptions.activeCheckMs; the DEK rotation runbook waits longer than this. */
export const ACTIVE_CHECK_MS = 30 * 1000

interface TenantKeys {
  keys: Map<string, DataKey>
  active?: string
  loadedAt: number
}

export interface FieldCryptoOptions {
  /** How long unwrapped DEKs stay cached in memory for decryption (default 5 minutes). */
  cacheTtlMs?: number
  /**
   * How long a cached answer to "which DEK is active" is trusted before
   * encrypting again (default 30 seconds, never longer than cacheTtlMs). A DEK
   * rotation retires the old key in the store; within this window every warm
   * instance stops writing under it. docs/FIELD-CRYPTO.md, DEK rotation.
   */
  activeCheckMs?: number
  now?: () => number
}

/**
 * The envelope-encryption service: finds (or creates) a tenant's DEK through
 * the store, caches unwrapped DEKs briefly, and encrypts, decrypts and indexes
 * fields. Every failure is a FieldCryptoError.
 */
export class FieldCrypto {
  private readonly cache = new Map<string, TenantKeys>()
  private readonly ttl: number
  private readonly activeCheckMs: number
  private readonly now: () => number

  constructor(
    private readonly ring: MasterKeyring,
    private readonly store: DekStore,
    opts: FieldCryptoOptions = {},
  ) {
    this.ttl = opts.cacheTtlMs ?? 5 * 60 * 1000
    this.activeCheckMs = Math.min(opts.activeCheckMs ?? ACTIVE_CHECK_MS, this.ttl)
    this.now = opts.now ?? Date.now
  }

  private async load(tenantId: string, force = false): Promise<TenantKeys> {
    requireId(tenantId)
    const hit = this.cache.get(tenantId)
    if (hit && !force && this.now() - hit.loadedAt < this.ttl) return hit
    let rows: DekRow[]
    try {
      rows = await this.store.listKeys(tenantId)
    } catch {
      throw new FieldCryptoError('store')
    }
    const keys = new Map<string, DataKey>()
    let active: string | undefined
    for (const r of rows) {
      if (r.tenant_id !== tenantId) continue
      keys.set(r.key_id, { keyId: r.key_id, key: unwrapDek(this.ring, tenantId, r.key_id, r.wrapped_dek) })
      if (!r.retired_at) active = r.key_id
    }
    const entry = { keys, active, loadedAt: this.now() }
    this.cache.set(tenantId, entry)
    return entry
  }

  /** The tenant's active DEK, creating (and wrapping) one on first use. */
  async activeKey(tenantId: string): Promise<DataKey> {
    let entry = await this.load(tenantId)
    // Never encrypt under a cached answer older than activeCheckMs: the key
    // may have been retired since (a DEK rotation after a suspected exposure).
    if (this.now() - entry.loadedAt >= this.activeCheckMs) entry = await this.load(tenantId, true)
    if (entry.active) return entry.keys.get(entry.active)!
    const dek = generateDek()
    const keyId = newDekId(new Date(this.now()))
    try {
      await this.store.insertKey({
        tenant_id: tenantId,
        key_id: keyId,
        master_key_id: this.ring.current.id,
        wrapped_dek: wrapDek(this.ring.current, tenantId, keyId, dek),
      })
    } catch {
      throw new FieldCryptoError('store')
    } finally {
      dek.fill(0)
    }
    // 'ok' or 'conflict' (a concurrent writer created one first): either way
    // the stored active row is the truth.
    entry = await this.load(tenantId, true)
    if (!entry.active) throw new FieldCryptoError('no_key')
    return entry.keys.get(entry.active)!
  }

  /** Any of the tenant's DEKs by id (retired included), reloading once on a miss. */
  async keyById(tenantId: string, keyId: string): Promise<DataKey | undefined> {
    let entry = await this.load(tenantId)
    if (!entry.keys.has(keyId)) entry = await this.load(tenantId, true)
    return entry.keys.get(keyId)
  }

  async allKeys(tenantId: string): Promise<DataKey[]> {
    return [...(await this.load(tenantId)).keys.values()]
  }

  async encrypt(ctx: FieldContext, plaintext: string): Promise<string> {
    return encryptField(await this.activeKey(ctx.tenantId), ctx, plaintext)
  }

  async decrypt(ctx: FieldContext, ciphertext: string): Promise<string> {
    const dek = await this.keyById(ctx.tenantId, fieldKeyId(ciphertext))
    if (!dek) throw new FieldCryptoError('no_key')
    return decryptField(dek, ctx, ciphertext)
  }

  /** The blind index under the tenant's active DEK (what a write stores). */
  async blindIndex(ctx: ColumnContext, value: string, normaliser: Normaliser): Promise<string | null> {
    return blindIndex(await this.activeKey(ctx.tenantId), ctx, value, normaliser)
  }

  /**
   * Every index `value` may be stored under — one per DEK the tenant has, so a
   * lookup still matches rows not yet re-indexed after a DEK rotation.
   */
  async blindIndexCandidates(ctx: ColumnContext, value: string, normaliser: Normaliser): Promise<string[]> {
    const keys = await this.allKeys(ctx.tenantId)
    return keys.map((k) => blindIndex(k, ctx, value, normaliser)).filter((v): v is string => v !== null)
  }

  /** Drop cached DEKs (tests; after a rotation). */
  clearCache(): void {
    this.cache.clear()
  }
}
