// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'

const { dispatch, owes } = vi.hoisted(() => ({
  dispatch: vi.fn(async (_db: unknown, id: string) => ({ outcome: id === 'm-noguardian' ? 'not_required' : 'issued' })),
  owes: new Set<string>(),
}))
vi.mock('@/lib/membership-agreement', () => ({
  dispatchMembershipAgreement: dispatch,
  membershipAgreementOutstanding: async (_db: unknown, id: string) => owes.has(id),
}))
vi.mock('@/lib/esign/outbox', () => ({ batchInvites: async (_db: unknown, fn: () => Promise<unknown>) => fn() }))

import { backfillMembershipAgreements } from './membership-backfill'

const member = (id: string, over: Record<string, unknown> = {}) => ({
  id, deleted_at: null, clerk_user_id: `user_${id}`, date_of_birth: '1990-01-01', email: `${id}@example.test`, event_role: 'adult', ...over,
})

function setup() {
  owes.clear()
  for (const id of ['m1', 'm2', 'm3', 'm-noguardian']) owes.add(id)
  return fakeSupabase({
    members: [
      member('m1'), member('m2'), member('m3'), member('m-noguardian', { date_of_birth: '2012-01-01' }),
      member('signed'),                                   // has an agreement: not owing
      member('volunteer', { event_role: 'volunteer' }),   // signs the mentor agreement instead
      member('invited', { date_of_birth: null }),         // has not onboarded yet
      member('deleted', { deleted_at: '2026-09-01T00:00:00Z' }),
      member('no-account', { clerk_user_id: null }),
    ],
  })
}

beforeEach(() => vi.clearAllMocks())

describe('backfillMembershipAgreements', () => {
  it('counts on a dry run and sends nothing', async () => {
    const db = setup()
    const out = await backfillMembershipAgreements(db.client, { dryRun: true, limit: 25 })
    expect(out).toMatchObject({ dryRun: true, candidates: 5, outstanding: 4, issued: 0 })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('issues to the next batch only, and reports what happened to each', async () => {
    const db = setup()
    const out = await backfillMembershipAgreements(db.client, { dryRun: false, limit: 3 })
    expect(dispatch.mock.calls.map((c) => c[1])).toEqual(['m-noguardian', 'm1', 'm2'])
    expect(out).toMatchObject({ issued: 2, outcomes: { issued: 2, not_required: 1 } })
  })
})
