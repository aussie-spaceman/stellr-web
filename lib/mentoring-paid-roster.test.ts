// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Paid one-off cohort seats (3 Nov 2026): the Stripe webhook rosters through
// rosterAfterPaidBooking, which re-runs the minor participation-agreement gate
// as a backstop. Enforced + locked → not added to the live cohort (the webhook
// records it for staff). Report-only → added as before; the gate logs itself.

const { state } = vi.hoisted(() => ({
  state: {
    enforced: false,
    unlocked: true,
    upserts: [] as { table: string; row: Record<string, unknown> }[],
    gateCalls: [] as { member: { id: string }; opts: Record<string, unknown> }[],
    lifecycle: 'active',
  },
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/access-gates', () => ({
  accessGatesEnforced: () => state.enforced,
  reportEnrollmentGate: async (member: { id: string }, opts: Record<string, unknown>) => {
    state.gateCalls.push({ member, opts })
    return { minorAgreement: state.unlocked, unlocked: state.unlocked }
  },
}))
vi.mock('@/lib/space-inheritance', () => ({ syncObjectSpaceRoster: async () => {} }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: table === 'mentoring_cohorts' ? { name: 'Rocketry', lifecycle: state.lifecycle } : null, error: null }),
        upsert: async (row: Record<string, unknown>) => {
          state.upserts.push({ table, row })
          return { error: null }
        },
      }
      return q
    },
  }),
}))

import { rosterAfterPaidBooking } from './mentoring'

beforeEach(() => {
  state.enforced = false
  state.unlocked = true
  state.upserts = []
  state.gateCalls = []
  state.lifecycle = 'active'
})

const rostered = () => state.upserts.filter((u) => u.table === 'cohort_members')

describe('rosterAfterPaidBooking: minor-agreement backstop', () => {
  it('rosters when the gate is unlocked', async () => {
    state.enforced = true
    expect(await rosterAfterPaidBooking('c1', 'm1')).toEqual({ rostered: true })
    expect(rostered()).toHaveLength(1)
    expect(state.gateCalls[0]).toEqual({
      member: { id: 'm1' },
      opts: { kind: 'cohort', containerId: 'c1', containerName: 'Rocketry' },
    })
  })

  it('holds a locked member out of the live cohort when enforced', async () => {
    state.enforced = true
    state.unlocked = false
    expect(await rosterAfterPaidBooking('c1', 'm1')).toEqual({ rostered: false, reason: 'needs-agreement' })
    expect(rostered()).toHaveLength(0)
  })

  it('still rosters a locked member in report-only mode, after running the gate', async () => {
    state.enforced = false
    state.unlocked = false
    expect(await rosterAfterPaidBooking('c1', 'm1')).toEqual({ rostered: true })
    expect(state.gateCalls).toHaveLength(1)
    expect(rostered()).toHaveLength(1)
  })
})

describe('rosterAfterPaidBooking: a cohort archived since Checkout', () => {
  it('holds the member for staff, enforced or not', async () => {
    state.lifecycle = 'archived'
    expect(await rosterAfterPaidBooking('c1', 'm1')).toEqual({ rostered: false, reason: 'cohort-archived' })
    expect(rostered()).toHaveLength(0)
  })
})
