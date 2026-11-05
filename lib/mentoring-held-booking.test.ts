// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// A held paid seat (3 Nov 2026). When the minor-agreement backstop keeps a paid
// member off the live cohort, the ledger booking stands ('reserved') but no
// cohort_members row is written, so resolveCohortAccess says "not enrolled".
// Without a check on the booking, the member could spend session credits (or
// pay again) for the same cohort before staff roster them by hand.

let db: FakeDb
const h = vi.hoisted(() => ({
  reserved: false,
  credits: 12,
  bookCohortFromAllocation: vi.fn(async () => true),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => db.client }))
vi.mock('@/lib/access-gates', () => ({
  accessGatesEnforced: () => true,
  reportEnrollmentGate: async () => ({ minorAgreement: true, unlocked: true }),
}))
vi.mock('@/lib/space-inheritance', () => ({ syncObjectSpaceRoster: async () => {} }))
vi.mock('@/lib/notify', () => ({ notifyMembers: async () => {} }))
vi.mock('@/lib/sessions', () => ({ linkCohortTraining: async () => {}, inviteMembersToCohort: async () => {} }))
vi.mock('@/lib/member-roles', () => ({ addGlobalRole: async () => {} }))
vi.mock('@/lib/compliance', () => ({ isClearedForMinorContact: async () => true }))
vi.mock('@/lib/community-delete-guard', () => ({ assertCohortDeletable: async () => {} }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => null }))
vi.mock('@/lib/entitlements', () => ({
  ensureMemberGrants: async () => {},
  getKindBalance: async () => ({ remaining: h.credits, used: 0, total: h.credits }),
  bookCohortFromAllocation: (...args: unknown[]) => h.bookCohortFromAllocation(...(args as [])),
  cancelCohortViaLedger: async () => {},
  hasReservedCohortBooking: async () => h.reserved,
}))

import { enrollWithCredit, enrollFree, getCohortFull } from './mentoring'
import type { CommunityMember } from './community'

const member = { id: 'm1', activeTierIds: ['tier-1'], isAdmin: false } as unknown as CommunityMember

function cohort(freeForTierIds: string[] = []) {
  return {
    id: 'c1', name: 'Rocketry', theme: 'space', timezone: null, planned_sessions: 6, start_date: null,
    is_open: true, blurb: null, free_for_tier_ids: freeForTierIds, one_off_price_cents: 12000,
    one_off_stripe_price_id: null, credit_cost: 1, mentor_member_id: 'mentor-1', lifecycle: 'active',
    container_type: 'mentoring', members: null, cohort_members: [],
  }
}

const rostered = () => db.table('cohort_members').filter((r) => r.member_id === 'm1' && r.status === 'active')

beforeEach(() => {
  h.reserved = false
  h.credits = 12
  h.bookCohortFromAllocation.mockClear()
})

// A member may sign up only to a cohort that is open and active, the two conditions
// Discover lists by, on every path.
describe('a cohort that takes no registrations', () => {
  it('reads lifecycle: without it no cohort would take a registration', async () => {
    let columns = ''
    const q = {
      select: (cols: string) => ((columns = cols), q),
      eq: () => q,
      maybeSingle: async () => ({ data: null, error: null }),
    }
    db = { client: { from: () => q } } as unknown as FakeDb
    expect(await getCohortFull('c1')).toBeNull()
    expect(columns.split(',').map((c) => c.trim())).toContain('lifecycle')
  })

  it('an open, active cohort takes them', async () => {
    db = fakeSupabase({ mentoring_cohorts: [cohort()], cohort_members: [], membership_tiers: [] })
    expect((await getCohortFull('c1'))?.takesRegistrations).toBe(true)
  })

  it.each([
    ['archived', { lifecycle: 'archived', is_open: true }],
    ['closed', { lifecycle: 'active', is_open: false }],
  ])('%s: no credit drawn, nobody rostered', async (_name, patch) => {
    db = fakeSupabase({ mentoring_cohorts: [{ ...cohort(['tier-1']), ...patch }], cohort_members: [], membership_tiers: [] })
    expect(await enrollFree(member, 'c1')).toEqual({ ok: false, reason: 'not-open' })
    db = fakeSupabase({ mentoring_cohorts: [{ ...cohort(), ...patch }], cohort_members: [], membership_tiers: [] })
    expect(await enrollWithCredit(member, 'c1')).toEqual({ ok: false, reason: 'not-open' })
    expect(h.bookCohortFromAllocation).not.toHaveBeenCalled()
    expect(rostered()).toHaveLength(0)
  })
})

describe('enrollWithCredit: a held paid seat', () => {
  it('refuses to draw credits when a reserved booking for the cohort already exists', async () => {
    h.reserved = true
    db = fakeSupabase({ mentoring_cohorts: [cohort()], cohort_members: [], membership_tiers: [] })
    expect(await enrollWithCredit(member, 'c1')).toEqual({ ok: false, reason: 'booking-pending' })
    expect(h.bookCohortFromAllocation).not.toHaveBeenCalled()
    expect(rostered()).toHaveLength(0)
  })

  it('still draws credits and rosters when there is no booking', async () => {
    db = fakeSupabase({ mentoring_cohorts: [cohort()], cohort_members: [], membership_tiers: [] })
    expect(await enrollWithCredit(member, 'c1')).toEqual({ ok: true })
    expect(h.bookCohortFromAllocation).toHaveBeenCalledTimes(1)
    expect(rostered()).toHaveLength(1)
  })

  it('an active roster row still answers "already enrolled", booking or not', async () => {
    h.reserved = true
    db = fakeSupabase({
      mentoring_cohorts: [cohort()],
      cohort_members: [{ cohort_id: 'c1', member_id: 'm1', status: 'active' }],
      membership_tiers: [],
    })
    expect(await enrollWithCredit(member, 'c1')).toEqual({ ok: false, reason: 'already-enrolled' })
  })
})

describe('enrollFree: a held paid seat', () => {
  it('refuses to roster around staff when a reserved booking exists', async () => {
    h.reserved = true
    db = fakeSupabase({ mentoring_cohorts: [cohort(['tier-1'])], cohort_members: [], membership_tiers: [] })
    expect(await enrollFree(member, 'c1')).toEqual({ ok: false, reason: 'booking-pending' })
    expect(rostered()).toHaveLength(0)
  })

  it('still rosters a free member with no booking', async () => {
    db = fakeSupabase({ mentoring_cohorts: [cohort(['tier-1'])], cohort_members: [], membership_tiers: [] })
    expect(await enrollFree(member, 'c1')).toEqual({ ok: true })
    expect(rostered()).toHaveLength(1)
  })
})
