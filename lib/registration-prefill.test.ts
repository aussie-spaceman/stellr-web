import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rows: {} as Record<string, unknown>,
}))

vi.mock('@/lib/community', () => ({ getCurrentMember: async () => null }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: h.rows[table] ?? null, error: null }),
      }
      return chain
    },
  }),
}))

import { getRegistrationPrefill } from './registration-prefill'
import type { CommunityMember } from './community'

const MEMBER = { id: 'm-1', email: 'kid@example.com', first_name: 'Kid', last_name: 'Lee' } as CommunityMember

describe('getRegistrationPrefill, date of birth', () => {
  beforeEach(() => {
    h.rows = {}
  })

  it('takes the member’s own record over a roster row, which someone else may have typed', async () => {
    h.rows = {
      members: { date_of_birth: '2010-05-01' },
      participants: { date_of_birth: '2001-01-01', first_name: 'Roster' },
    }
    const prefill = await getRegistrationPrefill(MEMBER)
    expect(prefill?.date_of_birth).toBe('2010-05-01')
    // The fields around it still prefer the richer roster row.
    expect(prefill?.first_name).toBe('Roster')
  })

  it('falls back to the roster row when the member has none', async () => {
    h.rows = { members: { date_of_birth: null }, participants: { date_of_birth: '2001-01-01' } }
    expect((await getRegistrationPrefill(MEMBER))?.date_of_birth).toBe('2001-01-01')
  })
})
