import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review PAY-16: the store checkout now resolves a buyer's tier discount via
// getActiveTierIdsByMember instead of a raw
// `.eq('renewal_status','active').maybeSingle()`. This pins the two properties the
// store route relies on: expired rows are excluded (an expired membership must not
// still discount), and a member with two active rows yields BOTH (the old
// maybeSingle errored and dropped the discount entirely).

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }))

function from() {
  const q: Record<string, unknown> = {
    select: () => q,
    in: () => q,
    eq: () => q,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: h.rows, error: null }).then(resolve),
  }
  return q
}
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from }) }))

import { getActiveTierIdsByMember } from './tiers-server'

beforeEach(() => {
  h.rows = []
})

describe('getActiveTierIdsByMember (PAY-16)', () => {
  it('excludes an expired row and returns every unexpired active tier', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0]
    const nextYear = new Date(Date.now() + 365 * 86_400_000).toISOString().split('T')[0]
    h.rows = [
      { member_id: 'm1', tier_id: 'tExpired', expires_at: yesterday, renewal_status: 'active' },
      { member_id: 'm1', tier_id: 'tPaid', expires_at: nextYear, renewal_status: 'active' },
      { member_id: 'm1', tier_id: 'tGrant', expires_at: null, renewal_status: 'active' },
    ]
    const out = await getActiveTierIdsByMember(['m1'])
    const ids = out.get('m1') ?? []
    expect(ids).not.toContain('tExpired')
    expect(ids).toEqual(expect.arrayContaining(['tPaid', 'tGrant']))
    expect(ids).toHaveLength(2)
  })
})
