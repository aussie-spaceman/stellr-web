// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { FieldCrypto, blindIndexEquals, fieldKeyId, isFieldCiphertext, type DekRow, type DekStore } from '@/lib/field-crypto'
import {
  applyShadowPatch,
  buildShadowPatch,
  encodeFieldValue,
  pgTextArrayLiteral,
  rowTenantId,
  shadowSelect,
  syncShadowRows,
  type ShadowRow,
} from '@/lib/field-crypto-patch'
import { bidxColumn, encColumn, sensitiveTable } from '@/lib/field-crypto-fields'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

const TENANT = STELLR_TENANT_ID
const PID = '11111111-2222-4333-8444-555555555555'

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
  }
}

const crypto = (store = memoryStore()) =>
  new FieldCrypto({ current: { id: 'mk-test', key: randomBytes(32) } }, store)

const participants = sensitiveTable('participants')

const participantRow = (over: Record<string, unknown> = {}) => ({
  id: PID,
  health_conditions: 'Asthma',
  dietary_requirements: ['Vegetarian', 'Nut allergy'],
  emergency_contact_first_name: 'Pat',
  emergency_contact_last_name: 'Example',
  emergency_contact_email: 'Guardian@Example.TEST',
  emergency_contact_phone: '(555) 010-0000',
  emergency_contact_relationship: 'Parent',
  registrations: { tenant_id: TENANT },
  ...over,
})

describe('encodeFieldValue', () => {
  const text = participants.fields.find((f) => f.column === 'health_conditions')!
  const arr = participants.fields.find((f) => f.column === 'dietary_requirements')!
  it('maps empty to null and arrays to JSON', () => {
    expect(encodeFieldValue(text, null)).toBeNull()
    expect(encodeFieldValue(text, '')).toBeNull()
    expect(encodeFieldValue(text, 'x')).toBe('x')
    expect(encodeFieldValue(arr, [])).toBeNull()
    expect(encodeFieldValue(arr, ['a', 'b'])).toBe('["a","b"]')
    expect(encodeFieldValue(arr, 'not an array')).toBeNull()
  })
})

describe('row tenant and select', () => {
  it('participants take the registration tenant; identity tables use the platform owner', () => {
    expect(rowTenantId(participants, participantRow())).toBe(TENANT)
    expect(rowTenantId(participants, participantRow({ registrations: [{ tenant_id: 'x-tenant' }] }))).toBe('x-tenant')
    expect(rowTenantId(participants, participantRow({ registrations: { tenant_id: null } }))).toBeNull()
    expect(rowTenantId(sensitiveTable('members'), { id: PID })).toBe(STELLR_TENANT_ID)
  })

  it('selects plaintext, shadow columns and the tenant join', () => {
    const sel = shadowSelect(participants)
    expect(sel).toContain('health_conditions_enc')
    expect(sel).toContain('emergency_contact_email_bidx')
    expect(sel).toContain('registrations(tenant_id)')
    expect(shadowSelect(sensitiveTable('member_pending_consent')).startsWith('member_id,')).toBe(true)
  })
})

describe('buildShadowPatch', () => {
  it('encrypts every non-empty sensitive column and indexes the lookup columns', async () => {
    const fc = crypto()
    const patch = await buildShadowPatch(fc, participants, participantRow(), TENANT)
    expect(Object.keys(patch).sort()).toEqual(
      [
        'dietary_requirements_enc',
        'emergency_contact_email_bidx',
        'emergency_contact_email_enc',
        'emergency_contact_first_name_enc',
        'emergency_contact_last_name_enc',
        'emergency_contact_phone_bidx',
        'emergency_contact_phone_enc',
        'emergency_contact_relationship_enc',
        'health_conditions_enc',
      ].sort(),
    )
    const ctx = { tenantId: TENANT, table: 'participants', rowId: PID }
    expect(await fc.decrypt({ ...ctx, column: 'health_conditions' }, patch.health_conditions_enc!)).toBe('Asthma')
    expect(JSON.parse(await fc.decrypt({ ...ctx, column: 'dietary_requirements' }, patch.dietary_requirements_enc!))).toEqual([
      'Vegetarian',
      'Nut allergy',
    ])
    // The index matches a lookup of the same address in another case.
    const idx = await fc.blindIndex({ tenantId: TENANT, table: 'participants', column: 'emergency_contact_email' }, 'guardian@example.test', 'email')
    expect(blindIndexEquals(patch.emergency_contact_email_bidx, idx)).toBe(true)
    // No column holds its plaintext: each is sf1 ciphertext that opens, under
    // authentication, to that column's value, and each index is a bi1 HMAC.
    // Don't search these for plaintext fragments: they are random base64url, so
    // a short string such as "Pat" turns up by chance and fails the test.
    const row = participantRow()
    for (const f of participants.fields) {
      const enc = patch[encColumn(f.column)]
      expect(isFieldCiphertext(enc), f.column).toBe(true)
      expect(await fc.decrypt({ ...ctx, column: f.column }, enc!)).toBe(encodeFieldValue(f, row[f.column as keyof typeof row]))
      if (f.blindIndex) expect(patch[bidxColumn(f.column)], f.column).toMatch(/^bi1\.[\w-]+\.[\w-]+$/)
    }
  })

  it('is a no-op for a row that is already current', async () => {
    const fc = crypto()
    const first = await buildShadowPatch(fc, participants, participantRow(), TENANT)
    const again = await buildShadowPatch(fc, participants, participantRow(first), TENANT)
    expect(again).toEqual({})
  })

  it('rewrites only the changed column and clears values whose plaintext was cleared', async () => {
    const fc = crypto()
    const first = await buildShadowPatch(fc, participants, participantRow(), TENANT)
    const changed = await buildShadowPatch(
      fc,
      participants,
      participantRow({ ...first, health_conditions: null, emergency_contact_email: 'new@example.test' }),
      TENANT,
    )
    expect(Object.keys(changed).sort()).toEqual(['emergency_contact_email_bidx', 'emergency_contact_email_enc', 'health_conditions_enc'])
    expect(changed.health_conditions_enc).toBeNull()
  })

  it('re-encrypts values written under a retired DEK or for another row', async () => {
    const store = memoryStore()
    const fc = crypto(store)
    const first = await buildShadowPatch(fc, participants, participantRow(), TENANT)
    // A ciphertext copied from another row does not open here and is rewritten.
    const moved = await buildShadowPatch(fc, participants, participantRow({ ...first, id: '99999999-2222-4333-8444-555555555555' }), TENANT)
    expect(moved.health_conditions_enc).toBeDefined()
    // After a DEK rotation every column moves to the new key.
    await store.retireKey!(TENANT, store.rows[0].key_id, new Date().toISOString())
    fc.clearCache()
    const rotated = await buildShadowPatch(fc, participants, participantRow(first), TENANT)
    expect(fieldKeyId(rotated.health_conditions_enc!)).not.toBe(store.rows[0].key_id)
    expect(rotated.emergency_contact_email_bidx).not.toBe(first.emergency_contact_email_bidx)
  })

  it('handles the identity tables', async () => {
    const fc = crypto()
    const p = await buildShadowPatch(
      fc,
      sensitiveTable('member_pending_consent'),
      { member_id: PID, guardian_name: 'Pat Example', guardian_email: 'pat@example.test' },
      STELLR_TENANT_ID,
    )
    expect(Object.keys(p).sort()).toEqual(['guardian_email_bidx', 'guardian_email_enc', 'guardian_name_enc'])
  })
})

/**
 * Just enough of the Supabase query builder for syncShadowRows: reads return
 * copies (as a real database does), and an UPDATE applies only to rows that
 * match every filter, returning them when `.select()` is chained.
 */
function fakeDb(
  rows: Record<string, unknown>[],
  opts: { failSelect?: boolean; failUpdate?: boolean; afterRead?: (n: number) => void } = {},
) {
  const updates: { patch: Record<string, unknown>; id: string }[] = []
  let reads = 0
  const db = {
    from() {
      return {
        select() {
          return {
            in: async (_col: string, ids: string[]) => {
              if (opts.failSelect) return { data: null, error: { code: 'XX000' } }
              const data = rows.filter((r) => ids.includes(r.id as string)).map((r) => structuredClone(r))
              opts.afterRead?.(++reads)
              return { data, error: null }
            },
          }
        },
        update(patch: Record<string, unknown>) {
          const preds: Array<(r: Record<string, unknown>) => boolean> = []
          let id = ''
          const builder = {
            eq(col: string, v: unknown) {
              if (col === 'id') id = v as string
              preds.push((r) => r[col] === v)
              return builder
            },
            is(col: string, v: null) {
              preds.push((r) => (r[col] ?? null) === v)
              return builder
            },
            filter(col: string, op: string, v: string) {
              if (op !== 'eq') throw new Error(`unsupported ${op}`)
              preds.push((r) => pgTextArrayLiteral(r[col]) === v)
              return builder
            },
            async select() {
              if (opts.failUpdate) return { data: null, error: { code: 'XX000' } }
              const hit = rows.filter((r) => preds.every((p) => p(r)))
              for (const r of hit) Object.assign(r, patch)
              if (hit.length) updates.push({ patch, id })
              return { data: hit.map((r) => ({ id: r.id })), error: null }
            },
          }
          return builder
        },
      }
    },
  }
  return { db: db as never, updates }
}

const ZERO = { updated: 0, unchanged: 0, skipped: 0, failed: 0, raced: 0 }

describe('syncShadowRows', () => {
  it('writes, then finds the row current on the next run', async () => {
    const rows = [participantRow()]
    const { db, updates } = fakeDb(rows)
    const fc = crypto()
    expect(await syncShadowRows(db, fc, 'participants', [PID, PID, ''])).toEqual({ ...ZERO, updated: 1 })
    expect(updates).toHaveLength(1)
    expect(await syncShadowRows(db, fc, 'participants', [PID])).toEqual({ ...ZERO, unchanged: 1 })
  })

  it('skips rows with no tenant and counts failures without throwing', async () => {
    const fc = crypto()
    const noTenant = fakeDb([participantRow({ registrations: null })])
    expect(await syncShadowRows(noTenant.db, fc, 'participants', [PID])).toMatchObject({ skipped: 1, updated: 0 })
    const badSelect = fakeDb([participantRow()], { failSelect: true })
    expect(await syncShadowRows(badSelect.db, fc, 'participants', [PID])).toMatchObject({ failed: 1 })
    const badUpdate = fakeDb([participantRow()], { failUpdate: true })
    expect(await syncShadowRows(badUpdate.db, fc, 'participants', [PID])).toMatchObject({ failed: 1 })
  })

  // Review finding (S4 shadow phase): an older sync that stalled between its
  // read and its UPDATE used to land last and write back the ciphertext of a
  // value that had since been erased.
  it('a stale sync cannot resurrect a value erased after it read the row', async () => {
    const rows: Record<string, unknown>[] = [participantRow()]
    const { db } = fakeDb(rows)
    const fc = crypto()
    // Sync A reads 'Asthma' (before its first ciphertext) and builds its patch, then stalls.
    const snapshotA = structuredClone(rows[0]) as ShadowRow
    const patchA = await buildShadowPatch(fc, participants, snapshotA, TENANT)
    expect(patchA.health_conditions_enc).toBeTruthy()
    // The member (or the retention job) clears the value; sync B runs.
    rows[0].health_conditions = null
    expect(await syncShadowRows(db, fc, 'participants', [PID])).toMatchObject({ updated: 1 })
    // A's UPDATE lands last: the compare-and-set refuses it.
    expect(await applyShadowPatch(db, participants, snapshotA, patchA)).toBe('raced')
    expect(rows[0].health_conditions).toBeNull()
    expect(rows[0].health_conditions_enc ?? null).toBeNull()
    // The rest of the row is still covered by B's write.
    expect(rows[0].emergency_contact_phone_enc).toBeTruthy()
  })

  it('a stale sync cannot overwrite a newer value with an older ciphertext', async () => {
    const rows: Record<string, unknown>[] = [participantRow()]
    const { db } = fakeDb(rows)
    const fc = crypto()
    await syncShadowRows(db, fc, 'participants', [PID])
    const snapshotA = structuredClone(rows[0]) as ShadowRow
    snapshotA.emergency_contact_phone_enc = null // A saw no ciphertext yet
    const patchA = await buildShadowPatch(fc, participants, snapshotA, TENANT)
    rows[0].emergency_contact_phone = '(555) 010-1234'
    await syncShadowRows(db, fc, 'participants', [PID])
    expect(await applyShadowPatch(db, participants, snapshotA, patchA)).toBe('raced')
    const ctx = { tenantId: TENANT, table: 'participants', column: 'emergency_contact_phone', rowId: PID }
    expect(await fc.decrypt(ctx, rows[0].emergency_contact_phone_enc as string)).toBe('(555) 010-1234')
  })

  it('re-reads and rebuilds when the plaintext changes between read and write', async () => {
    const rows: Record<string, unknown>[] = [participantRow()]
    const { db } = fakeDb(rows, {
      afterRead: (n) => {
        if (n === 1) {
          rows[0].emergency_contact_phone = '(555) 010-9999'
          rows[0].dietary_requirements = ['Vegan, "strict"']
        }
      },
    })
    const fc = crypto()
    expect(await syncShadowRows(db, fc, 'participants', [PID])).toEqual({ ...ZERO, updated: 1 })
    const ctx = (column: string) => ({ tenantId: TENANT, table: 'participants', column, rowId: PID })
    expect(await fc.decrypt(ctx('emergency_contact_phone'), rows[0].emergency_contact_phone_enc as string)).toBe('(555) 010-9999')
    expect(await fc.decrypt(ctx('dietary_requirements'), rows[0].dietary_requirements_enc as string)).toBe(
      JSON.stringify(['Vegan, "strict"']),
    )
  })

  it('gives up after a few attempts on a row that keeps changing, writing nothing stale', async () => {
    const rows: Record<string, unknown>[] = [participantRow()]
    const { db, updates } = fakeDb(rows, { afterRead: (n) => (rows[0].health_conditions = `changed ${n}`) })
    expect(await syncShadowRows(db, crypto(), 'participants', [PID])).toEqual({ ...ZERO, raced: 1 })
    expect(updates).toHaveLength(0)
  })

  it('writes nothing when a row disappears between attempts', async () => {
    const rows: Record<string, unknown>[] = [participantRow()]
    const { db, updates } = fakeDb(rows, {
      afterRead: (n) => {
        if (n === 1) rows[0].health_conditions = 'changed'
        if (n === 2) rows.splice(0, 1)
      },
    })
    expect(await syncShadowRows(db, crypto(), 'participants', [PID])).toEqual({ ...ZERO, unchanged: 1 })
    expect(updates).toHaveLength(0)
  })
})

describe('applyShadowPatch', () => {
  it('refuses to write without a guard for every plaintext column', async () => {
    const { db, updates } = fakeDb([participantRow()])
    const row = participantRow() as ShadowRow
    delete row.health_conditions
    expect(await applyShadowPatch(db, participants, row, { health_conditions_enc: null })).toBe('error')
    expect(await applyShadowPatch(db, participants, participantRow({ dietary_requirements: [1] }), {})).toBe('error')
    expect(updates).toHaveLength(0)
  })

  it('builds PostgREST array literals that escape quotes and backslashes', () => {
    expect(pgTextArrayLiteral([])).toBe('{}')
    expect(pgTextArrayLiteral(['a', 'b c'])).toBe('{"a","b c"}')
    expect(pgTextArrayLiteral(['say "hi"', 'back\\slash', null])).toBe('{"say \\"hi\\"","back\\\\slash",NULL}')
    expect(pgTextArrayLiteral('x')).toBeNull()
  })
})
