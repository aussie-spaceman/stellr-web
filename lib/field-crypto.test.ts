// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  ACTIVE_CHECK_MS,
  FieldCrypto,
  FieldCryptoError,
  blindIndex,
  blindIndexEquals,
  decryptField,
  encryptField,
  fieldCryptoActive,
  fieldCryptoMode,
  fieldKeyId,
  isFieldCiphertext,
  loadMasterKeyring,
  newDekId,
  normaliseForIndex,
  rewrapDek,
  unwrapDek,
  wrapDek,
  wrappedMasterId,
  type DataKey,
  type DekRow,
  type DekStore,
  type FieldContext,
  type MasterKeyring,
} from '@/lib/field-crypto'
import { GcmOpenError, openGcm, sealGcm } from '@/lib/esign/backup-crypto'

// Every key here is generated per run. No real key is ever committed.
const freshKey = () => randomBytes(32)
const b64 = (b: Buffer) => b.toString('base64')
const TENANT_A = '00000000-0000-4000-8000-000000000001'
const TENANT_B = '00000000-0000-4000-8000-0000000000b2'
const ROW = '11111111-2222-4333-8444-555555555555'
const ctx: FieldContext = { tenantId: TENANT_A, table: 'participants', column: 'health_conditions', rowId: ROW }
const dek = (): DataKey => ({ keyId: 'dtest-1', key: freshKey() })
const ring = (): MasterKeyring => ({ current: { id: 'mk-test-a', key: freshKey() } })

/** An in-memory tenant_data_keys with the same one-active-key rule as the migration. */
function memoryStore(): DekStore & { rows: DekRow[] } {
  const rows: DekRow[] = []
  return {
    rows,
    async listKeys(t) {
      return rows.filter((r) => r.tenant_id === t)
    },
    async insertKey(r) {
      if (rows.some((x) => x.tenant_id === r.tenant_id && !x.retired_at)) return 'conflict'
      rows.push({ ...r, created_at: new Date().toISOString(), retired_at: null })
      return 'ok'
    },
    async retireKey(t, k, at) {
      for (const r of rows) if (r.tenant_id === t && r.key_id === k && !r.retired_at) r.retired_at = at
    },
    async updateWrapped(t, k, m, w) {
      for (const r of rows) if (r.tenant_id === t && r.key_id === k) Object.assign(r, { master_key_id: m, wrapped_dek: w })
    },
  }
}

function expectCode(fn: () => unknown, code: string) {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(FieldCryptoError)
    expect((e as FieldCryptoError).code).toBe(code)
    return
  }
  throw new Error(`expected FieldCryptoError(${code})`)
}

async function expectCodeAsync(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(FieldCryptoError)
  await p.catch((e: FieldCryptoError) => expect(e.code).toBe(code))
}

describe('sealGcm / openGcm (backup-crypto extension)', () => {
  it('round-trips and binds the AAD', () => {
    const key = freshKey()
    const sealed = sealGcm(key, Buffer.from('hello'), Buffer.from('ctx-1'))
    expect(openGcm(key, sealed, Buffer.from('ctx-1')).toString()).toBe('hello')
    expect(() => openGcm(key, sealed, Buffer.from('ctx-2'))).toThrow(GcmOpenError)
    expect(() => openGcm(freshKey(), sealed, Buffer.from('ctx-1'))).toThrow(GcmOpenError)
  })

  it('rejects a truncated value and a wrong-length key', () => {
    const key = freshKey()
    expect(() => openGcm(key, Buffer.alloc(10), Buffer.alloc(0))).toThrow(GcmOpenError)
    expect(() => sealGcm(Buffer.alloc(16), Buffer.from('x'), Buffer.alloc(0))).toThrow(RangeError)
  })

  it('uses a fresh IV every time', () => {
    const key = freshKey()
    const a = sealGcm(key, Buffer.from('same'), Buffer.alloc(0))
    const b = sealGcm(key, Buffer.from('same'), Buffer.alloc(0))
    expect(a.equals(b)).toBe(false)
  })
})

describe('configuration', () => {
  it('defaults to off and treats anything unknown as off', () => {
    expect(fieldCryptoMode({})).toBe('off')
    expect(fieldCryptoMode({ FIELD_CRYPTO_MODE: 'SHADOW ' })).toBe('shadow')
    expect(fieldCryptoMode({ FIELD_CRYPTO_MODE: 'read' })).toBe('read')
    expect(fieldCryptoMode({ FIELD_CRYPTO_MODE: 'enforce' })).toBe('off')
  })

  it('is inert with no master key', () => {
    expect(loadMasterKeyring({})).toBeNull()
    expect(fieldCryptoActive({ FIELD_CRYPTO_MODE: 'shadow' })).toBe(false)
  })

  it('is inert in off mode even with a key', () => {
    const env = { FIELD_CRYPTO_MASTER_KEY: b64(freshKey()), FIELD_CRYPTO_KEY_ID: 'k1' }
    expect(fieldCryptoActive(env)).toBe(false)
    expect(fieldCryptoActive({ ...env, FIELD_CRYPTO_MODE: 'shadow' })).toBe(true)
  })

  it('loads current and previous keys', () => {
    const r = loadMasterKeyring({
      FIELD_CRYPTO_MASTER_KEY: b64(freshKey()),
      FIELD_CRYPTO_KEY_ID: 'k2',
      FIELD_CRYPTO_PREVIOUS_MASTER_KEY: b64(freshKey()),
      FIELD_CRYPTO_PREVIOUS_KEY_ID: 'k1',
    })
    expect(r?.current.id).toBe('k2')
    expect(r?.previous?.id).toBe('k1')
  })

  it.each([
    ['a 16-byte key', { FIELD_CRYPTO_MASTER_KEY: b64(randomBytes(16)), FIELD_CRYPTO_KEY_ID: 'k1' }],
    ['a key without an id', { FIELD_CRYPTO_MASTER_KEY: b64(freshKey()) }],
    ['an id without a key', { FIELD_CRYPTO_KEY_ID: 'k1' }],
    ['a bad id', { FIELD_CRYPTO_MASTER_KEY: b64(freshKey()), FIELD_CRYPTO_KEY_ID: 'has.dot' }],
    ['non-base64', { FIELD_CRYPTO_MASTER_KEY: '!!!not base64!!!', FIELD_CRYPTO_KEY_ID: 'k1' }],
    ['only a previous key', { FIELD_CRYPTO_PREVIOUS_MASTER_KEY: b64(freshKey()), FIELD_CRYPTO_PREVIOUS_KEY_ID: 'k0' }],
    [
      'previous sharing the current id',
      {
        FIELD_CRYPTO_MASTER_KEY: b64(freshKey()),
        FIELD_CRYPTO_KEY_ID: 'k1',
        FIELD_CRYPTO_PREVIOUS_MASTER_KEY: b64(freshKey()),
        FIELD_CRYPTO_PREVIOUS_KEY_ID: 'k1',
      },
    ],
  ])('refuses %s with a config error that carries no key material', (_label, env) => {
    try {
      loadMasterKeyring(env)
      throw new Error('expected a config error')
    } catch (e) {
      expect(e).toBeInstanceOf(FieldCryptoError)
      expect((e as FieldCryptoError).code).toBe('config')
      const text = `${(e as Error).message} ${(e as Error).stack}`
      for (const v of Object.values(env)) if (v && v.length > 8) expect(text).not.toContain(v)
    }
    expect(fieldCryptoActive({ ...env, FIELD_CRYPTO_MODE: 'shadow' })).toBe(false)
  })
})

describe('field encryption', () => {
  it('round-trips, including unicode and the empty string', () => {
    const k = dek()
    for (const v of ['Asthma — carries inhaler', '花粉症', '', 'x'.repeat(5000)]) {
      const c = encryptField(k, ctx, v)
      expect(c.startsWith('sf1.dtest-1.')).toBe(true)
      expect(isFieldCiphertext(c)).toBe(true)
      expect(fieldKeyId(c)).toBe('dtest-1')
      expect(decryptField(k, ctx, c)).toBe(v)
    }
  })

  it('never puts the plaintext in the ciphertext and never repeats a ciphertext', () => {
    const k = dek()
    const a = encryptField(k, ctx, 'peanut allergy')
    const b = encryptField(k, ctx, 'peanut allergy')
    expect(a).not.toBe(b)
    expect(a).not.toContain('peanut')
  })

  it.each([
    ['another tenant', { ...ctx, tenantId: TENANT_B }],
    ['another table', { ...ctx, table: 'members' }],
    ['another column', { ...ctx, column: 'emergency_contact_phone' }],
    ['another row', { ...ctx, rowId: '99999999-2222-4333-8444-555555555555' }],
  ])('fails to open under %s (AAD binding)', (_label, other) => {
    const k = dek()
    const c = encryptField(k, ctx, 'epilepsy')
    expectCode(() => decryptField(k, other, c), 'auth')
  })

  it('fails under the wrong key, and an unknown key id is no_key', () => {
    const k = dek()
    const c = encryptField(k, ctx, 'diabetes')
    expectCode(() => decryptField({ keyId: 'dtest-1', key: freshKey() }, ctx, c), 'auth')
    expectCode(() => decryptField({ keyId: 'other', key: k.key }, ctx, c), 'no_key')
    expectCode(() => decryptField(() => undefined, ctx, c), 'no_key')
  })

  it('detects tampering with any byte, and a swapped key id', () => {
    const k = dek()
    const c = encryptField(k, ctx, 'tamper me')
    const [v, kid, body] = c.split('.')
    const raw = Buffer.from(body, 'base64url')
    for (const i of [0, 12, 20, raw.length - 1]) {
      const t = Buffer.from(raw)
      t[i] ^= 0x01
      expectCode(() => decryptField(k, ctx, `${v}.${kid}.${t.toString('base64url')}`), 'auth')
    }
    // The key id is part of the AAD: relabelling the ciphertext breaks it.
    const relabelled = { keyId: 'dtest-2', key: k.key }
    expectCode(() => decryptField(relabelled, ctx, `${v}.dtest-2.${body}`), 'auth')
    // Truncation.
    expectCode(() => decryptField(k, ctx, `${v}.${kid}.${raw.subarray(0, 20).toString('base64url')}`), 'auth')
  })

  it.each(['', 'plain text', 'sf2.k.AAAA', 'sf1..AAAA', 'sf1.k.not base64!', 'sf1.k', 'sf1.k.AA.extra'])(
    'rejects %j as not a ciphertext',
    (bad) => {
      expect(isFieldCiphertext(bad)).toBe(false)
      expectCode(() => decryptField(dek(), ctx, bad), 'format')
    },
  )

  it('rejects malformed contexts', () => {
    const k = dek()
    expectCode(() => encryptField(k, { ...ctx, table: 'Participants; drop' }, 'x'), 'input')
    expectCode(() => encryptField(k, { ...ctx, rowId: '' }, 'x'), 'input')
    expectCode(() => encryptField({ keyId: 'bad.id', key: k.key }, ctx, 'x'), 'input')
  })
})

describe('data-key wrapping and master-key rotation', () => {
  it('wraps and unwraps, binding tenant and key id', () => {
    const r = ring()
    const d = freshKey()
    const w = wrapDek(r.current, TENANT_A, 'd1', d)
    expect(w.startsWith('wk1.mk-test-a.')).toBe(true)
    expect(wrappedMasterId(w)).toBe('mk-test-a')
    expect(unwrapDek(r, TENANT_A, 'd1', w).equals(d)).toBe(true)
    expectCode(() => unwrapDek(r, TENANT_B, 'd1', w), 'auth')
    expectCode(() => unwrapDek(r, TENANT_A, 'd2', w), 'auth')
  })

  it('old master key still unwraps; rewrap moves the DEK to the new master', () => {
    const oldRing = ring()
    const d = freshKey()
    const w = wrapDek(oldRing.current, TENANT_A, 'd1', d)
    const rotated: MasterKeyring = { current: { id: 'mk-test-b', key: freshKey() }, previous: oldRing.current }
    expect(unwrapDek(rotated, TENANT_A, 'd1', w).equals(d)).toBe(true)
    const w2 = rewrapDek(rotated, TENANT_A, 'd1', w)
    expect(wrappedMasterId(w2)).toBe('mk-test-b')
    // Once the previous key is dropped, only the re-wrapped value opens.
    const newOnly: MasterKeyring = { current: rotated.current }
    expect(unwrapDek(newOnly, TENANT_A, 'd1', w2).equals(d)).toBe(true)
    expectCode(() => unwrapDek(newOnly, TENANT_A, 'd1', w), 'no_key')
  })

  it('a wrong master key with the same id fails authentication', () => {
    const r = ring()
    const w = wrapDek(r.current, TENANT_A, 'd1', freshKey())
    expectCode(() => unwrapDek({ current: { id: 'mk-test-a', key: freshKey() } }, TENANT_A, 'd1', w), 'auth')
  })

  it('makes well-formed DEK ids', () => {
    const id = newDekId(new Date('2026-11-04T00:00:00Z'))
    expect(id).toMatch(/^d20261104-[A-Za-z0-9_-]{8}$/)
  })
})

describe('blind indexes', () => {
  const col = { tenantId: TENANT_A, table: 'participants', column: 'emergency_contact_email' }

  it('is stable for the same key and normalised value', () => {
    const k = dek()
    const a = blindIndex(k, col, '  Parent@Example.TEST ', 'email')
    const b = blindIndex(k, col, 'parent@example.test', 'email')
    expect(a).toBe(b)
    expect(a).toMatch(/^bi1\.dtest-1\.[A-Za-z0-9_-]{43}$/)
    expect(blindIndexEquals(a, b)).toBe(true)
  })

  it('is keyed: differs by DEK, tenant and column, and never contains the value', () => {
    const k = dek()
    const base = blindIndex(k, col, 'parent@example.test', 'email')!
    expect(blindIndex(dek(), col, 'parent@example.test', 'email')).not.toBe(base)
    expect(blindIndex(k, { ...col, tenantId: TENANT_B }, 'parent@example.test', 'email')).not.toBe(base)
    expect(blindIndex(k, { ...col, column: 'ec_email' }, 'parent@example.test', 'email')).not.toBe(base)
    expect(base).not.toContain('parent')
  })

  it('normalises phones and text, and returns null for empty', () => {
    expect(normaliseForIndex('(555) 010-0000', 'phone')).toBe('5550100000')
    expect(normaliseForIndex('+61 400 000 000', 'phone')).toBe('+61400000000')
    expect(normaliseForIndex('  Jane   DOE ', 'text')).toBe('jane doe')
    const k = dek()
    expect(blindIndex(k, col, '   ', 'email')).toBeNull()
    expect(blindIndex(k, col, '(555) 010-0000', 'phone')).toBe(blindIndex(k, col, '555.010.0000', 'phone'))
  })

  it('compares in constant time and handles unequal lengths and nulls', () => {
    expect(blindIndexEquals('bi1.k.AAAA', 'bi1.k.AAAA')).toBe(true)
    expect(blindIndexEquals('bi1.k.AAAA', 'bi1.k.AAAB')).toBe(false)
    expect(blindIndexEquals('bi1.k.AAAA', 'bi1.k.AAAAA')).toBe(false)
    expect(blindIndexEquals(null, 'x')).toBe(false)
    expect(blindIndexEquals(undefined, undefined)).toBe(false)
  })
})

describe('FieldCrypto service', () => {
  it('creates one DEK per tenant on first use and reuses it', async () => {
    const store = memoryStore()
    const fc = new FieldCrypto(ring(), store)
    const c1 = await fc.encrypt(ctx, 'asthma')
    const c2 = await fc.encrypt({ ...ctx, rowId: '22222222-2222-4333-8444-555555555555' }, 'asthma')
    expect(store.rows).toHaveLength(1)
    expect(fieldKeyId(c1)).toBe(fieldKeyId(c2))
    expect(await fc.decrypt(ctx, c1)).toBe('asthma')
    await fc.encrypt({ ...ctx, tenantId: TENANT_B }, 'asthma')
    expect(store.rows).toHaveLength(2)
    expect(store.rows.every((r) => r.wrapped_dek.startsWith('wk1.mk-test-a.'))).toBe(true)
  })

  it('a second instance (another server) reads the stored DEK', async () => {
    const store = memoryStore()
    const r = ring()
    const c = await new FieldCrypto(r, store).encrypt(ctx, 'hay fever')
    expect(await new FieldCrypto(r, store).decrypt(ctx, c)).toBe('hay fever')
  })

  it('a concurrent first write converges on one key', async () => {
    const store = memoryStore()
    const r = ring()
    const [a, b] = await Promise.all([new FieldCrypto(r, store).activeKey(TENANT_A), new FieldCrypto(r, store).activeKey(TENANT_A)])
    expect(store.rows).toHaveLength(1)
    expect(a.keyId).toBe(b.keyId)
    expect(a.key.equals(b.key)).toBe(true)
  })

  it('DEK rotation: the old key decrypts, the new key encrypts, lookups match both', async () => {
    const store = memoryStore()
    const fc = new FieldCrypto(ring(), store)
    const col = { tenantId: TENANT_A, table: 'participants', column: 'emergency_contact_email' }
    const oldCipher = await fc.encrypt(ctx, 'old value')
    const oldIdx = await fc.blindIndex(col, 'parent@example.test', 'email')
    const oldKey = fieldKeyId(oldCipher)
    await store.retireKey!(TENANT_A, oldKey, new Date().toISOString())
    fc.clearCache()
    const newCipher = await fc.encrypt(ctx, 'new value')
    expect(fieldKeyId(newCipher)).not.toBe(oldKey)
    expect(await fc.decrypt(ctx, oldCipher)).toBe('old value')
    expect(await fc.decrypt(ctx, newCipher)).toBe('new value')
    const candidates = await fc.blindIndexCandidates(col, 'PARENT@example.test', 'email')
    expect(candidates).toHaveLength(2)
    expect(candidates.some((c) => blindIndexEquals(c, oldIdx))).toBe(true)
  })

  it('master-key rotation: data wrapped under the previous master still decrypts', async () => {
    const store = memoryStore()
    const oldRing = ring()
    const c = await new FieldCrypto(oldRing, store).encrypt(ctx, 'migraine')
    const rotated: MasterKeyring = { current: { id: 'mk-test-b', key: freshKey() }, previous: oldRing.current }
    const fc = new FieldCrypto(rotated, store)
    expect(await fc.decrypt(ctx, c)).toBe('migraine')
    // Re-wrap every DEK, then drop the previous master.
    for (const row of store.rows) {
      await store.updateWrapped!(row.tenant_id, row.key_id, 'mk-test-b', rewrapDek(rotated, row.tenant_id, row.key_id, row.wrapped_dek))
    }
    expect(await new FieldCrypto({ current: rotated.current }, store).decrypt(ctx, c)).toBe('migraine')
    // Without either key nothing opens.
    await expectCodeAsync(new FieldCrypto(ring(), store).decrypt(ctx, c), 'no_key')
  })

  it('a store failure surfaces as a store error with no detail', async () => {
    const broken: DekStore = {
      listKeys: vi.fn().mockRejectedValue(new Error('connection to db-host refused, password=hunter2')),
      insertKey: vi.fn(),
    }
    const p = new FieldCrypto(ring(), broken).encrypt(ctx, 'x')
    await expectCodeAsync(p, 'store')
    await p.catch((e: Error) => expect(e.message).not.toContain('hunter2'))
  })

  it('caches DEKs for the TTL, then reloads', async () => {
    const store = memoryStore()
    const spy = vi.spyOn(store, 'listKeys')
    let now = 1_000_000
    const fc = new FieldCrypto(ring(), store, { cacheTtlMs: 1000, now: () => now })
    await fc.activeKey(TENANT_A) // load (empty) + insert + reload
    const calls = spy.mock.calls.length
    await fc.activeKey(TENANT_A)
    expect(spy.mock.calls.length).toBe(calls)
    now += 1001
    await fc.activeKey(TENANT_A)
    expect(spy.mock.calls.length).toBe(calls + 1)
  })

  // Review finding (S4 shadow phase): a warm instance kept encrypting under a
  // DEK that another instance had retired, for the whole 5-minute cache.
  it('DEK rotation: a warm instance stops encrypting under a retired DEK within activeCheckMs', async () => {
    const store = memoryStore()
    const r = ring()
    let now = 1_000_000
    const warm = new FieldCrypto(r, store, { now: () => now }) // default TTL and activeCheckMs
    const k1 = fieldKeyId(await warm.encrypt(ctx, 'before'))
    // An ops instance retires k1 and creates k2.
    const ops = new FieldCrypto(r, store)
    await store.retireKey!(TENANT_A, k1, new Date().toISOString())
    const k2 = (await ops.activeKey(TENANT_A)).keyId
    expect(k2).not.toBe(k1)
    // Inside the window the warm cache may still answer k1 ...
    now += ACTIVE_CHECK_MS - 1
    expect(fieldKeyId(await warm.encrypt(ctx, 'during'))).toBe(k1)
    // ... and never after it, although the 5-minute DEK cache has not expired.
    now += 2
    expect(fieldKeyId(await warm.encrypt(ctx, 'after'))).toBe(k2)
    expect((await warm.blindIndex({ tenantId: TENANT_A, table: 'participants', column: 'emergency_contact_email' }, 'a@example.test', 'email'))!.split('.')[1]).toBe(k2)
  })

  it('activeCheckMs never exceeds the cache TTL', async () => {
    const store = memoryStore()
    const spy = vi.spyOn(store, 'listKeys')
    let now = 1_000_000
    const fc = new FieldCrypto(ring(), store, { cacheTtlMs: 10, activeCheckMs: 60_000, now: () => now })
    await fc.activeKey(TENANT_A)
    const calls = spy.mock.calls.length
    now += 11
    await fc.activeKey(TENANT_A)
    expect(spy.mock.calls.length).toBe(calls + 1)
  })
})
