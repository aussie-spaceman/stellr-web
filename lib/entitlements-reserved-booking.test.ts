// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// hasReservedCohortBooking (3 Nov 2026): the enrol paths' check for a seat
// already paid for or drawn but not rostered (a held paid seat).

let db: FakeDb
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ schema: () => db.client }) }))

import { hasReservedCohortBooking } from './entitlements'

const offering = { id: 'off-1', cohort_id: 'c1', type: 'mentoring_cohort' }
const booking = (over: Record<string, unknown> = {}) => ({ id: 'b-1', member_id: 'm1', offering_id: 'off-1', status: 'reserved', ...over })

describe('hasReservedCohortBooking', () => {
  it("finds the member's reserved booking for the cohort's offering", async () => {
    db = fakeSupabase({ offerings: [offering], bookings: [booking()] })
    expect(await hasReservedCohortBooking('m1', 'c1')).toBe(true)
  })

  it('ignores a cancelled booking, another member, and another offering', async () => {
    db = fakeSupabase({
      offerings: [offering, { id: 'off-2', cohort_id: 'c2', type: 'mentoring_cohort' }],
      bookings: [booking({ status: 'cancelled' }), booking({ id: 'b-2', member_id: 'm2' }), booking({ id: 'b-3', offering_id: 'off-2' })],
    })
    expect(await hasReservedCohortBooking('m1', 'c1')).toBe(false)
  })

  it('is false when the cohort has no offering yet, and creates none', async () => {
    db = fakeSupabase({ offerings: [], bookings: [] })
    expect(await hasReservedCohortBooking('m1', 'c1')).toBe(false)
    expect(db.table('offerings')).toHaveLength(0)
  })

  it('counts a failed read as a booking, so a read error cannot take a second payment', async () => {
    db = fakeSupabase({ offerings: [offering], bookings: [] }, { failOn: (t) => (t === 'bookings' ? 'boom' : null) })
    expect(await hasReservedCohortBooking('m1', 'c1')).toBe(true)
  })
})
