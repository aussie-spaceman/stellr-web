// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// deep review MEM-19: hostRespond had no status precondition, so a repeated
// cancel/decline ran releaseCoachingBooking again each time — inflating the
// member's coaching allowance by one included booking per repeat call. The
// transition now requires status='scheduled' and acts only if a row changed.
const { state } = vi.hoisted(() => ({ state: { db: null as FakeDb | null, releaseCount: 0 } }))

vi.mock('@/lib/notify', () => ({ notifyMember: async () => {}, notifyMembers: async () => {}, notifyCommunityAdmins: async () => {} }))
vi.mock('@/lib/activity-log', () => ({ logActivity: async () => {} }))
vi.mock('@/lib/compliance', () => ({ isClearedForMinorContact: async () => true }))
vi.mock('@/lib/community', () => ({ getCurrentMember: async () => null }))
vi.mock('@/lib/containers', () => ({ containerAccessPersists: async () => true }))
vi.mock('@/lib/container-sync', () => ({ ensureCoachingContainer: async () => 'container-1' }))
vi.mock('@/lib/entitlements', () => ({
  ensureMemberGrants: async () => {},
  bookCoachingSessionFromAllocation: async () => {},
  releaseCoachingBooking: async () => {
    state.releaseCount += 1
    return true
  },
}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => state.db!.client }))

const { hostRespond } = await import('./sessions')

beforeEach(() => {
  vi.clearAllMocks()
  state.releaseCount = 0
  state.db = fakeSupabase({
    sessions: [
      {
        id: 's1',
        host_member_id: 'coach-1',
        member_id: 'kid-1',
        cohort_id: null,
        scheduled_start: '2026-11-01T10:00:00Z',
        session_type: 'coaching',
        is_paid_extra: false,
        status: 'scheduled',
      },
    ],
    session_participants: [{ session_id: 's1', member_id: 'kid-1' }],
  })
})

describe('hostRespond — repeat cancel does not inflate the allowance (MEM-19)', () => {
  it('releases exactly one booking across two cancel calls', async () => {
    const first = await hostRespond('s1', 'coach-1', 'cancelled')
    const second = await hostRespond('s1', 'coach-1', 'cancelled')
    expect(first).toBe(true)
    expect(second).toBe(false) // already terminal — no-op
    expect(state.releaseCount).toBe(1)
    expect(state.db!.table('sessions')[0].status).toBe('cancelled')
  })
})
