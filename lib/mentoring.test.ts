// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review MEM-9 (safeguarding): grantMentorRole must refuse an uncleared
// adult. We drive the clearance result and assert the role write only happens
// when cleared.
const { state } = vi.hoisted(() => ({
  state: {
    cleared: false,
    upserts: 0,
    globalRoles: [] as string[],
    // Every `.update(vals).eq(...)` the code issues, recorded by table.
    updates: [] as { table: string; vals: Record<string, unknown> }[],
  },
}))

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
    from: (table: string) => ({
      upsert: async () => {
        state.upserts += 1
        return { error: null }
      },
      update: (vals: Record<string, unknown>) => ({
        eq: async () => {
          state.updates.push({ table, vals })
          return { error: null }
        },
      }),
    }),
  }),
}))

import { grantMentorRole, reassignMentor } from './mentoring'

beforeEach(() => {
  state.cleared = false
  state.upserts = 0
  state.globalRoles = []
  state.updates = []
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

describe('reassignMentor — clearance gate runs BEFORE the pointer write (deep review MEM-N1)', () => {
  it('throws for an uncleared new mentor and NEVER writes mentor_member_id', async () => {
    // The write used to land first, so the throw left mentoring_cohorts pointed at
    // an uncleared adult — and canAccessChannel authorises cohort chat on that
    // pointer. Assert no mentoring_cohorts update is issued when uncleared.
    await expect(reassignMentor('cohort-1', 'uncleared-9')).rejects.toThrow(/cleared/i)
    expect(state.updates.filter((u) => u.table === 'mentoring_cohorts')).toHaveLength(0)
  })

  it('writes mentor_member_id once the new mentor is cleared', async () => {
    state.cleared = true
    await reassignMentor('cohort-1', 'cleared-7')
    const cohortWrites = state.updates.filter((u) => u.table === 'mentoring_cohorts')
    expect(cohortWrites).toHaveLength(1)
    expect(cohortWrites[0].vals).toEqual({ mentor_member_id: 'cleared-7' })
  })
})
