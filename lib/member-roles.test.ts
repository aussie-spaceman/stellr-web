import { describe, it, expect, vi } from 'vitest'

// syncMemberClassificationRole reads the member's bracket from the passed db and
// upserts member_roles. We record the upserted rows to assert which roles it grants.
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({}) }))

import { syncMemberClassificationRole } from './member-roles'

function makeDb(bracket: string | null) {
  const upserts: Array<Array<{ role: string }>> = []
  const db = {
    from(table: string) {
      if (table === 'members') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { age_bracket: bracket }, error: null }) }) }),
        }
      }
      // member_roles
      return {
        upsert: (rows: Array<{ role: string }>) => {
          upserts.push(rows)
          return Promise.resolve({ error: null })
        },
      }
    },
  }
  return { db: db as never, rolesOf: () => upserts.flat().map((r) => r.role) }
}

describe('syncMemberClassificationRole — deep review MEM-3 (self-service may not grant MANAGE roles)', () => {
  it('withholds the global mentor role from self-service onboarding (allowManageRoles:false)', async () => {
    const { db, rolesOf } = makeDb('adult')
    await syncMemberClassificationRole(db, 'm1', 'mentor', { allowManageRoles: false })
    expect(rolesOf()).toContain('member')
    expect(rolesOf()).not.toContain('mentor')
  })

  it('withholds the global teacher role from self-service onboarding', async () => {
    const { db, rolesOf } = makeDb('adult')
    await syncMemberClassificationRole(db, 'm1', 'teacher', { allowManageRoles: false })
    expect(rolesOf()).not.toContain('teacher')
  })

  it('still grants non-manage classification roles (parent) under self-service', async () => {
    const { db, rolesOf } = makeDb('adult')
    await syncMemberClassificationRole(db, 'm1', 'parent', { allowManageRoles: false })
    expect(rolesOf()).toEqual(expect.arrayContaining(['member', 'parent']))
  })

  it('by default (admin paths) still grants the manage role', async () => {
    const { db, rolesOf } = makeDb('adult')
    await syncMemberClassificationRole(db, 'm1', 'mentor')
    expect(rolesOf()).toContain('mentor')
  })
})
