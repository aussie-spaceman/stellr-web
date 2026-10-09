// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review MEM-9 (safeguarding): grantMentorRole must refuse an uncleared
// adult. We drive the clearance result and assert the role write only happens
// when cleared.
const { state } = vi.hoisted(() => ({ state: { cleared: false, upserts: 0, globalRoles: [] as string[] } }))

vi.mock('@/lib/compliance', () => ({
  isClearedForMinorContact: async () => state.cleared,
}))
vi.mock('@/lib/member-roles', () => ({
  addGlobalRole: async (_db: unknown, _id: string, role: string) => {
    state.globalRoles.push(role)
    return { ok: true }
  },
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => ({
      upsert: async () => {
        state.upserts += 1
        return { error: null }
      },
    }),
  }),
}))

import { grantMentorRole } from './mentoring'

beforeEach(() => {
  state.cleared = false
  state.upserts = 0
  state.globalRoles = []
})

describe('grantMentorRole — background-clearance gate', () => {
  it('throws for an uncleared member and writes no role', async () => {
    await expect(grantMentorRole('m1')).rejects.toThrow(/cleared/i)
    expect(state.upserts).toBe(0)
    expect(state.globalRoles).not.toContain('mentor')
  })

  it('grants the mentor role when the member is cleared', async () => {
    state.cleared = true
    await grantMentorRole('m1')
    expect(state.upserts).toBe(1)
    expect(state.globalRoles).toContain('mentor')
  })
})
