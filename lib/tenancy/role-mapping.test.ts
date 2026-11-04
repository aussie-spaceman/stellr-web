// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { planRoleMapping, MAPPING_SOURCE } from './role-mapping'
import { STELLR_TENANT_ID } from './constants'

const empty = { clerkAdminIds: [], eventManagers: [], staff: [], existingMemberships: [], existingPlatformAdmins: [] }

describe('planRoleMapping', () => {
  it('maps Clerk admins to platform admins and Stellr tenant admins', () => {
    const plan = planRoleMapping({ ...empty, clerkAdminIds: ['user_b', 'user_a', 'user_a'] })
    expect(plan.platformAdmins).toEqual(['user_a', 'user_b'])
    expect(plan.memberships).toEqual([
      { tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_a', member_id: null, role: 'tenant_admin', source: MAPPING_SOURCE },
      { tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_b', member_id: null, role: 'tenant_admin', source: MAPPING_SOURCE },
    ])
  })

  it('gives each event manager one Stellr membership however many events they manage', () => {
    const plan = planRoleMapping({ ...empty, eventManagers: [{ clerk_user_id: 'user_m' }, { clerk_user_id: 'user_m' }] })
    expect(plan.memberships).toHaveLength(1)
    expect(plan.memberships[0]).toMatchObject({ clerk_user_id: 'user_m', role: 'event_manager' })
    expect(plan.platformAdmins).toEqual([])
  })

  it('keys staff by member, carrying the Clerk id when there is one', () => {
    const plan = planRoleMapping({
      ...empty,
      staff: [
        { member_id: 'm1', clerk_user_id: 'user_s' },
        { member_id: 'm2', clerk_user_id: null },
        { member_id: 'm1', clerk_user_id: 'user_s' },
      ],
    })
    expect(plan.memberships.map((m) => [m.member_id, m.clerk_user_id, m.role])).toEqual([
      ['m1', 'user_s', 'staff'],
      ['m2', null, 'staff'],
    ])
  })

  it('is idempotent: rows that already exist are counted, not planned', () => {
    const plan = planRoleMapping({
      ...empty,
      clerkAdminIds: ['user_a'],
      staff: [{ member_id: 'm1', clerk_user_id: null }],
      existingPlatformAdmins: [{ clerk_user_id: 'user_a' }],
      existingMemberships: [
        { tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_a', member_id: null, role: 'tenant_admin' },
        { tenant_id: STELLR_TENANT_ID, clerk_user_id: null, member_id: 'm1', role: 'staff' },
      ],
    })
    expect(plan).toEqual({ platformAdmins: [], memberships: [], alreadyPresent: 2 })
  })

  it('treats one person holding two roles as two memberships', () => {
    const plan = planRoleMapping({ ...empty, clerkAdminIds: ['user_x'], eventManagers: [{ clerk_user_id: 'user_x' }] })
    expect(plan.memberships.map((m) => m.role).sort()).toEqual(['event_manager', 'tenant_admin'])
  })
})
