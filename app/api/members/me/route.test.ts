// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// deep review MEM-16: the allergy/ethnicity replace was delete-then-insert with
// the insert error only logged, so a bad option id silently wiped a member's
// recorded set (event medical data) while the API still reported success. The
// fix validates ids up front (reject, touch nothing), restores on a transient
// insert failure, surfaces non-2xx, and normalises a blank enum to null.
const { state } = vi.hoisted(() => ({ state: { db: null as FakeDb | null, failInsert: false } }))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'clerk-1' }) }))
vi.mock('@/lib/impersonation', () => ({
  assertNotImpersonating: async () => null,
  impersonatedMemberId: async () => null,
}))
vi.mock('@/lib/activity-log', () => ({ logActivity: async () => {} }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => state.db!.client }))

const { PATCH } = await import('./route')

const patch = (body: unknown) =>
  PATCH(new Request('https://app.test/api/members/me', { method: 'PATCH', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  state.failInsert = false
  state.db = fakeSupabase(
    {
      members: [{ id: 'mem-1', clerk_user_id: 'clerk-1', is_active: true, first_name: 'A', last_name: 'B', gender: 'male', phone: null }],
      allergy_options: [{ id: 'al-1' }, { id: 'al-2' }],
      ethnicity_options: [{ id: 'eth-1' }],
      member_allergies: [{ member_id: 'mem-1', allergy_option_id: 'al-1' }],
      member_ethnicities: [],
    },
    { failOn: (table, action) => (state.failInsert && table === 'member_allergies' && action === 'insert' ? 'insert boom' : null) },
  )
})

describe('PATCH /api/members/me — allergy/ethnicity integrity (MEM-16)', () => {
  it('rejects an unknown allergy id and leaves the stored set untouched', async () => {
    const res = await patch({ allergy_ids: ['al-1', 'bogus'] })
    expect(res.status).toBe(400)
    // The previous selection must survive — nothing deleted on a bad id.
    expect(state.db!.table('member_allergies').map((r) => r.allergy_option_id)).toEqual(['al-1'])
  })

  it('surfaces a 500 when the insert fails (rather than reporting success)', async () => {
    state.failInsert = true
    const res = await patch({ allergy_ids: ['al-2'], phone: '123' })
    expect(res.status).toBe(500)
  })

  it('normalises a blank enum value to null', async () => {
    const res = await patch({ gender: '' })
    expect(res.status).toBe(200)
    expect(state.db!.table('members')[0].gender).toBeNull()
  })

  it('accepts a valid allergy change', async () => {
    const res = await patch({ allergy_ids: ['al-2'] })
    expect(res.status).toBe(200)
    expect(state.db!.table('member_allergies').map((r) => r.allergy_option_id)).toEqual(['al-2'])
  })
})
