// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { diffRoleMapping, dualWriteConsequence, dualWriteTarget, formatRoleDrift, planRoleMapping, roleDriftCount, MAPPING_SOURCE, type RoleDiffInput } from './role-mapping'
import { STELLR_TENANT_ID } from './constants'

const OTHER_TENANT = '11111111-1111-4111-8111-111111111111'

const empty = { clerkAdminIds: [], eventManagers: [], duties: [], existingMemberships: [], existingPlatformAdmins: [] }

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
      duties: [
        { member_id: 'm1', clerk_user_id: 'user_s' },
        { member_id: 'm2', clerk_user_id: null },
        { member_id: 'm1', clerk_user_id: 'user_s' },
      ],
    })
    expect(plan.memberships.map((m) => [m.member_id, m.clerk_user_id, m.role])).toEqual([
      ['m1', 'user_s', 'duty_holder'],
      ['m2', null, 'duty_holder'],
    ])
  })

  it('is idempotent: rows that already exist are counted, not planned', () => {
    const plan = planRoleMapping({
      ...empty,
      clerkAdminIds: ['user_a'],
      duties: [{ member_id: 'm1', clerk_user_id: null }],
      existingPlatformAdmins: [{ clerk_user_id: 'user_a' }],
      existingMemberships: [
        { tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_a', member_id: null, role: 'tenant_admin' },
        { tenant_id: STELLR_TENANT_ID, clerk_user_id: null, member_id: 'm1', role: 'duty_holder' },
      ],
    })
    expect(plan).toEqual({ platformAdmins: [], memberships: [], alreadyPresent: 2 })
  })

  it('treats one person holding two roles as two memberships', () => {
    const plan = planRoleMapping({ ...empty, clerkAdminIds: ['user_x'], eventManagers: [{ clerk_user_id: 'user_x' }] })
    expect(plan.memberships.map((m) => m.role).sort()).toEqual(['event_manager', 'tenant_admin'])
  })

  it("never turns an assignment on another tenant's event into a Stellr membership", () => {
    const plan = planRoleMapping({
      ...empty,
      eventManagers: [
        { clerk_user_id: 'user_other', tenant_id: OTHER_TENANT },
        { clerk_user_id: 'user_null', tenant_id: null },
        { clerk_user_id: 'user_stellr', tenant_id: STELLR_TENANT_ID },
      ],
    })
    expect(plan.memberships.map((m) => m.clerk_user_id).sort()).toEqual(['user_null', 'user_stellr'])
  })
})

describe('diffRoleMapping', () => {
  /** A mirror that agrees with its authorities: one of each role. */
  const seeded = (): RoleDiffInput => ({
    clerkAdminIds: ['user_a'],
    clerkEventManagerIds: ['user_m'],
    eventManagers: [{ clerk_user_id: 'user_m', tenant_id: STELLR_TENANT_ID }, { clerk_user_id: 'user_m', tenant_id: null }],
    duties: [{ member_id: 'm1', clerk_user_id: 'user_s' }],
    existingMemberships: [
      { tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_a', member_id: null, role: 'tenant_admin' },
      { tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_m', member_id: null, role: 'event_manager' },
      { tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_s', member_id: 'm1', role: 'duty_holder' },
    ],
    existingPlatformAdmins: [{ clerk_user_id: 'user_a' }],
  })

  it('reports zero drift on a seeded mirror', () => {
    const drift = diffRoleMapping(seeded())
    expect(roleDriftCount(drift)).toBe(0)
    expect(formatRoleDrift(drift)).toEqual([])
  })

  it('reports drift after the Clerk admin role is removed out of band', () => {
    const drift = diffRoleMapping({ ...seeded(), clerkAdminIds: [] })
    expect(drift.stale).toEqual([{ clerk_user_id: 'user_a', member_id: null, role: 'tenant_admin' }])
    expect(drift.platformAdminsWithoutClerkAdmin).toEqual(['user_a'])
    expect(roleDriftCount(drift)).toBe(2)
  })

  it('reports drift after the Clerk admin role is added out of band', () => {
    const drift = diffRoleMapping({ ...seeded(), clerkAdminIds: ['user_a', 'user_new'] })
    expect(drift.missing).toMatchObject([{ clerk_user_id: 'user_new', role: 'tenant_admin' }])
    expect(roleDriftCount(drift)).toBe(1)
  })

  it('reports the Clerk event_manager role set out of band with no assignment', () => {
    const drift = diffRoleMapping({ ...seeded(), clerkEventManagerIds: ['user_m', 'user_em'] })
    expect(drift.claimWithoutAssignment).toEqual(['user_em'])
    expect(roleDriftCount(drift)).toBe(1)
  })

  it("accepts the Clerk event_manager role backed only by another tenant's assignment and membership", () => {
    const base = seeded()
    const drift = diffRoleMapping({
      ...base,
      clerkEventManagerIds: [...base.clerkEventManagerIds, 'user_other'],
      eventManagers: [...base.eventManagers, { clerk_user_id: 'user_other', tenant_id: OTHER_TENANT }],
      existingMemberships: [...base.existingMemberships, { tenant_id: OTHER_TENANT, clerk_user_id: 'user_other', member_id: null, role: 'event_manager' }],
    })
    expect(drift.claimWithoutAssignment).toEqual([])
    expect(roleDriftCount(drift)).toBe(0)
  })

  it("still reports another tenant's manager whose membership is missing, though the claim is backed", () => {
    const base = seeded()
    const drift = diffRoleMapping({
      ...base,
      clerkEventManagerIds: [...base.clerkEventManagerIds, 'user_other'],
      eventManagers: [...base.eventManagers, { clerk_user_id: 'user_other', tenant_id: OTHER_TENANT }],
    })
    expect(drift.claimWithoutAssignment).toEqual([])
    expect(drift.otherTenantManagers).toEqual([{ tenant_id: OTHER_TENANT, clerk_user_id: 'user_other', kind: 'assignment_without_membership' }])
    expect(roleDriftCount(drift)).toBe(1)
  })

  it('reports an assignment whose holder has no portal role in Clerk', () => {
    const drift = diffRoleMapping({ ...seeded(), clerkEventManagerIds: [] })
    expect(drift.assignmentWithoutClaim).toEqual(['user_m'])
    expect(roleDriftCount(drift)).toBe(1)
  })

  it('accepts an admin who also holds an assignment, with no event_manager role', () => {
    const base = seeded()
    const drift = diffRoleMapping({
      ...base,
      eventManagers: [...base.eventManagers, { clerk_user_id: 'user_a' }],
      existingMemberships: [...base.existingMemberships, { tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_a', member_id: null, role: 'event_manager' }],
    })
    expect(roleDriftCount(drift)).toBe(0)
  })

  it('reports a membership left behind when its last assignment or staff row went', () => {
    const drift = diffRoleMapping({ ...seeded(), eventManagers: [], clerkEventManagerIds: [], duties: [] })
    expect(drift.stale.map((m) => m.role)).toEqual(['duty_holder', 'event_manager'])
  })

  it('reports a membership missing after a staff row is added', () => {
    const base = seeded()
    const drift = diffRoleMapping({ ...base, duties: [...base.duties, { member_id: 'm2', clerk_user_id: null }] })
    expect(drift.missing).toMatchObject([{ member_id: 'm2', role: 'duty_holder' }])
  })

  it('matches a staff row by either key, so a Clerk id gained later is not drift', () => {
    const base = seeded()
    expect(
      roleDriftCount(
        diffRoleMapping({
          ...base,
          existingMemberships: base.existingMemberships.map((m) => (m.role === 'duty_holder' ? { ...m, clerk_user_id: null } : m)),
        }),
      ),
    ).toBe(0)
    expect(
      roleDriftCount(
        diffRoleMapping({
          ...base,
          existingMemberships: base.existingMemberships.map((m) => (m.role === 'duty_holder' ? { ...m, member_id: null } : m)),
        }),
      ),
    ).toBe(0)
  })

  it("never counts another tenant's rows or assignments as Stellr drift", () => {
    const base = seeded()
    const drift = diffRoleMapping({
      ...base,
      eventManagers: [...base.eventManagers, { clerk_user_id: 'user_other', tenant_id: OTHER_TENANT }],
      existingMemberships: [
        ...base.existingMemberships,
        { tenant_id: OTHER_TENANT, clerk_user_id: 'user_other', member_id: null, role: 'tenant_admin' },
        { tenant_id: OTHER_TENANT, clerk_user_id: 'user_other', member_id: null, role: 'event_manager' },
      ],
    })
    expect(roleDriftCount(drift)).toBe(0)
  })

  it("reports another tenant's event_manager row left without an assignment", () => {
    const base = seeded()
    const drift = diffRoleMapping({
      ...base,
      existingMemberships: [...base.existingMemberships, { tenant_id: OTHER_TENANT, clerk_user_id: 'user_other', member_id: null, role: 'event_manager' }],
    })
    expect(drift.otherTenantManagers).toEqual([{ tenant_id: OTHER_TENANT, clerk_user_id: 'user_other', kind: 'membership_without_assignment' }])
    expect(drift.stale).toEqual([])
    expect(roleDriftCount(drift)).toBe(1)
    expect(formatRoleDrift(drift)[0]).toContain('membership without assignment')
  })

  it("reports another tenant's assignment with no membership, as a refused cross-tenant write leaves", () => {
    const base = seeded()
    const drift = diffRoleMapping({ ...base, eventManagers: [...base.eventManagers, { clerk_user_id: 'user_other', tenant_id: OTHER_TENANT }] })
    expect(drift.otherTenantManagers).toEqual([{ tenant_id: OTHER_TENANT, clerk_user_id: 'user_other', kind: 'assignment_without_membership' }])
    expect(drift.missing).toEqual([])
    expect(roleDriftCount(drift)).toBe(1)
  })

  it("does not compare another tenant's other roles: they have no legacy authority", () => {
    const base = seeded()
    const drift = diffRoleMapping({
      ...base,
      existingMemberships: [...base.existingMemberships, { tenant_id: OTHER_TENANT, clerk_user_id: 'user_other', member_id: null, role: 'tenant_admin' }],
    })
    expect(roleDriftCount(drift)).toBe(0)
  })

  it('lists a Clerk admin outside platform_admins without failing: that list is the owner decision', () => {
    const drift = diffRoleMapping({ ...seeded(), existingPlatformAdmins: [] })
    expect(drift.clerkAdminsNotPlatform).toEqual(['user_a'])
    expect(roleDriftCount(drift)).toBe(0)
  })

  it('reports every kind on its own line', () => {
    const lines = formatRoleDrift(
      diffRoleMapping({
        ...seeded(),
        clerkAdminIds: ['user_b'],
        clerkEventManagerIds: ['user_c'],
      }),
    )
    expect(lines).toHaveLength(5)
    expect(lines.join('\n')).toMatch(/missing membership[\s\S]*stale membership[\s\S]*platform admin[\s\S]*no assignment[\s\S]*no Clerk portal role/)
  })
})

describe('dualWriteConsequence', () => {
  it('tells the operator of a failed revoke that the person keeps access under postgres', () => {
    expect(dualWriteConsequence(true)).toMatch(/KEEPS access/)
    expect(dualWriteConsequence(false)).not.toMatch(/KEEPS access/)
  })
})

describe('dualWriteTarget', () => {
  const dev = { hasDbCredentials: true, isProductionDb: false, clerkLive: false, productionFlag: false }

  it('writes on a matching non-production pair', () => {
    expect(dualWriteTarget(dev)).toEqual({ write: true })
  })
  it('skips with no database credentials', () => {
    expect(dualWriteTarget({ ...dev, hasDbCredentials: false }).write).toBe(false)
  })
  it('skips when Clerk and Supabase are from different environments, either way round', () => {
    expect(dualWriteTarget({ ...dev, clerkLive: true }).write).toBe(false)
    expect(dualWriteTarget({ ...dev, isProductionDb: true, productionFlag: true }).write).toBe(false)
  })
  it('needs the flag for production', () => {
    expect(dualWriteTarget({ ...dev, isProductionDb: true, clerkLive: true }).write).toBe(false)
    expect(dualWriteTarget({ ...dev, isProductionDb: true, clerkLive: true, productionFlag: true })).toEqual({ write: true })
  })
})

describe('Staff (13 Nov 2026)', () => {
  const base = { clerkAdminIds: [], eventManagers: [], duties: [], existingMemberships: [], existingPlatformAdmins: [] }
  it('maps a Clerk staff role to a Stellr staff membership, keyed by Clerk id', () => {
    expect(planRoleMapping({ ...base, clerkStaffIds: ['user_s'] }).memberships).toMatchObject([
      { tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_s', member_id: null, role: 'staff' },
    ])
  })
  it('never plans Staff for another tenant', () => {
    expect(planRoleMapping({ ...base, clerkStaffIds: ['user_s'] }, 'another-tenant').memberships).toEqual([])
  })
  it('a staff row is stale once the Clerk role is gone, and unknown when Clerk staff ids were not read', () => {
    const existingMemberships = [{ tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_s', member_id: null, role: 'staff' }]
    const diff = { ...base, clerkEventManagerIds: [], existingMemberships }
    expect(diffRoleMapping({ ...diff, clerkStaffIds: [] }).stale).toEqual([{ clerk_user_id: 'user_s', member_id: null, role: 'staff' }])
    expect(diffRoleMapping({ ...diff, clerkStaffIds: ['user_s'] }).stale).toEqual([])
    expect(diffRoleMapping(diff).stale).toEqual([])
  })
})

