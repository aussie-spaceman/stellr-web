// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { FieldCrypto, blindIndexEquals, fieldKeyId, type DekRow, type DekStore } from '@/lib/field-crypto'
import { buildShadowPatch, encodeFieldValue, rowTenantId, shadowSelect, syncShadowRows } from '@/lib/field-crypto-patch'
import { sensitiveTable } from '@/lib/field-crypto-fields'
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
    for (const v of Object.values(patch)) expect(v).not.toMatch(/Asthma|Pat|Example|555/)
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

/** Just enough of the Supabase query builder for syncShadowRows. */
function fakeDb(rows: Record<string, unknown>[], opts: { failSelect?: boolean; failUpdate?: boolean } = {}) {
  const updates: { patch: Record<string, unknown>; id: string }[] = []
  const db = {
    from() {
      return {
        select() {
          return {
            in: async (_col: string, ids: string[]) =>
              opts.failSelect
                ? { data: null, error: { code: 'XX000' } }
                : { data: rows.filter((r) => ids.includes(r.id as string)), error: null },
          }
        },
        update(patch: Record<string, unknown>) {
          return {
            eq: async (_col: string, id: string) => {
              if (opts.failUpdate) return { error: { code: 'XX000' } }
              updates.push({ patch, id })
              const row = rows.find((r) => r.id === id)
              if (row) Object.assign(row, patch)
              return { error: null }
            },
          }
        },
      }
    },
  }
  return { db: db as never, updates }
}

describe('syncShadowRows', () => {
  it('writes, then finds the row current on the next run', async () => {
    const rows = [participantRow()]
    const { db, updates } = fakeDb(rows)
    const fc = crypto()
    expect(await syncShadowRows(db, fc, 'participants', [PID, PID, ''])).toEqual({ updated: 1, unchanged: 0, skipped: 0, failed: 0 })
    expect(updates).toHaveLength(1)
    expect(await syncShadowRows(db, fc, 'participants', [PID])).toEqual({ updated: 0, unchanged: 1, skipped: 0, failed: 0 })
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
})
