// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review MEM-5 (performance): getSpaceForMember computes the member count
// via resolveSpaceAudiences, which scans the WHOLE members / memberships / roles
// tables. The feed's 8 s poll needs access + channels, never the count, so a
// caller may pass { withCounts: false } to skip that scan. We assert the
// member_memberships table (only ever read by the audience scan) is queried with
// counts and NOT without.
const { state } = vi.hoisted(() => ({ state: { tables: [] as string[] } }))

const SPACE_ROW = {
  id: 'space-1',
  slug: 'general',
  name: 'General',
  description: null,
  theme: 'space',
  access_type: 'open',
  is_archived: false,
  posting_policy: 'all',
  allow_member_uploads: true,
}

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from(table: string) {
      state.tables.push(table)
      const arrayResult = { data: table === 'community_spaces' ? [SPACE_ROW] : [], error: null }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        is: () => chain,
        order: () => chain,
        range: () => chain,
        maybeSingle: async () => ({ data: table === 'community_spaces' ? SPACE_ROW : null, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(arrayResult).then(resolve),
      }
      return chain
    },
  }),
}))

import { getSpaceForMember } from './spaces'
import type { CommunityMember } from './community'

const MEMBER = {
  id: 'me',
  isAdmin: false,
  activeTierIds: [],
  age_bracket: 'adult',
  date_of_birth: '1990-01-01',
  event_role: 'subscriber',
} as unknown as CommunityMember

beforeEach(() => {
  state.tables = []
})

describe('getSpaceForMember — MEM-5 member-count scan is opt-out', () => {
  it('skips the full-table audience scan when withCounts:false', async () => {
    const space = await getSpaceForMember(MEMBER, 'general', { withCounts: false })
    expect(space?.access.canAccess).toBe(true)
    expect(space?.memberCount).toBe(0)
    // member_memberships is only ever read by resolveSpaceAudiences.
    expect(state.tables).not.toContain('member_memberships')
  })

  it('still computes the count (and runs the scan) by default', async () => {
    await getSpaceForMember(MEMBER, 'general')
    expect(state.tables).toContain('member_memberships')
  })
})
