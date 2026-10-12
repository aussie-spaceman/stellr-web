// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// deep review QUAL-8: the server-side "DOB says minor → high_school/participant"
// backstop used `new Date().getFullYear() - dob.getFullYear()`, which over-counts
// anyone whose birthday is later in the year. A 17-year-old born in December read
// as 18, so a minor could be created with an adult bracket/role. The fix routes
// the check through lib/age (isMinorOn), the one calendar-correct age module.
const { state } = vi.hoisted(() => ({ state: { db: null as FakeDb | null } }))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ sessionClaims: {} }) }))
vi.mock('@/lib/admin-auth', () => ({ isAdminClaims: () => true }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => state.db!.client }))
vi.mock('@/lib/entitlements', () => ({ grantTierAllocations: async () => {} }))
vi.mock('@/lib/member-profile-options', () => ({ syncMemberOptionSelections: async () => {} }))
vi.mock('@/lib/community', () => ({ getSignedInMember: async () => ({ id: 'admin' }) }))
vi.mock('@/lib/member-invite', () => ({ sendAccountInvite: async () => ({}) }))

const { POST } = await import('./route')

const post = (body: Record<string, unknown>) =>
  POST(new Request('https://app.test/api/admin/members', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  state.db = fakeSupabase({ members: [] })
  // Pin the clock: on 8 Oct 2026 a member born 15 Dec 2008 is 17, not 18.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-08T12:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('POST /api/admin/members — minor backstop (QUAL-8)', () => {
  it('stores a December-born 17-year-old as a minor even when the request says adult', async () => {
    const res = await post({
      first_name: 'Dawn', last_name: 'December', email: 'dawn@example.test',
      date_of_birth: '2008-12-15', gender: 'female',
      age_bracket: 'adult', event_role: 'subscriber',
      send_invite: false,
    })
    expect(res.status).toBe(201)
    const [member] = state.db!.table('members')
    // Fails on the old year-subtraction backstop (2026 - 2008 = 18 → "adult").
    expect(member.age_bracket).toBe('high_school')
    expect(member.event_role).toBe('participant')
  })

  it('leaves a genuine adult alone', async () => {
    const res = await post({
      first_name: 'Adam', last_name: 'Adult', email: 'adam@example.test',
      date_of_birth: '1990-01-01', gender: 'male',
      age_bracket: 'adult', event_role: 'subscriber',
      send_invite: false,
    })
    expect(res.status).toBe(201)
    const member = state.db!.table('members').find((m) => m.email === 'adam@example.test')!
    expect(member.age_bracket).toBe('adult')
    expect(member.event_role).toBe('subscriber')
  })
})
