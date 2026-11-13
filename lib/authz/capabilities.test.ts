import { describe, expect, it } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { CANARY_TENANT_ID, membership, principal } from '@/test/fixtures/authz-principal'
import { anonymousPrincipal, decideEventAccess, decidePortalAccess, decideCrewTarget, decideTenantRole, isStaffHiddenAdminPath, isStellrStaff, portalRoleFromClaims, tenantRoles } from './decide'
import { CAPABILITIES, STAFF_CAPABILITIES, capabilitiesOf, decideCapability } from './capabilities'

const ADMIN_ONLY = CAPABILITIES.filter((c) => !STAFF_CAPABILITIES.includes(c))
const clerkStaff = principal({ claimsRole: 'staff' })
const pgStaff = principal({ memberships: [membership('staff')] })

describe('the Staff capability set (owner decisions, 13 Nov 2026)', () => {
  it('is exactly read, Competitions and Members writes, refunds, assigning Event Managers, and export', () => {
    expect([...STAFF_CAPABILITIES].sort()).toEqual(
      ['competitions:write', 'event_managers:assign', 'export', 'members:write', 'portal:read', 'refunds:write', 'schools:write', 'volunteers:write'].sort(),
    )
  })
  it('leaves clearance, deletion, roles, Duties, scholarships, the access console, view-as and privacy requests to admins', () => {
    expect([...ADMIN_ONLY].sort()).toEqual(
      ['access:manage', 'clearance:verify', 'duties:manage', 'impersonate', 'members:delete', 'privacy:read', 'roles:manage', 'scholarships:write'].sort(),
    )
  })
})

describe('decideCapability', () => {
  it.each(['clerk', 'postgres'] as const)('%s: an admin holds every capability', (source) => {
    const admin = source === 'clerk' ? principal({ claimsRole: 'admin' }) : principal({ memberships: [membership('tenant_admin')] })
    for (const c of CAPABILITIES) expect(decideCapability(admin, c, source)).toEqual({ ok: true, via: 'admin' })
  })
  it.each([['clerk', clerkStaff], ['postgres', pgStaff]] as const)('%s: Staff holds its set and nothing else', (source, staff) => {
    for (const c of STAFF_CAPABILITIES) expect(decideCapability(staff, c, source)).toEqual({ ok: true, via: 'staff' })
    for (const c of ADMIN_ONLY) expect(decideCapability(staff, c, source)).toEqual({ ok: false, status: 403 })
  })
  it('denies by default: an event manager, a duty holder, a member and the signed-out', () => {
    for (const p of [principal({ claimsRole: 'event_manager' }), principal({ memberships: [membership('duty_holder')] }), principal({ claimsRole: 'member' })]) {
      for (const c of CAPABILITIES) {
        expect(decideCapability(p, c, 'clerk').ok).toBe(false)
        expect(decideCapability(p, c, 'postgres').ok).toBe(false)
      }
    }
    expect(decideCapability(anonymousPrincipal(), 'portal:read', 'clerk')).toEqual({ ok: false, status: 401 })
  })
  it('Staff is Stellr’s alone: nothing on another tenant’s host, in either source', () => {
    for (const c of CAPABILITIES) {
      expect(decideCapability(clerkStaff, c, 'clerk', CANARY_TENANT_ID).ok).toBe(false)
      expect(decideCapability(pgStaff, c, 'postgres', CANARY_TENANT_ID).ok).toBe(false)
      expect(decideCapability(principal({ memberships: [membership('staff', CANARY_TENANT_ID)] }), c, 'postgres', CANARY_TENANT_ID).ok).toBe(false)
    }
  })
  it('capabilitiesOf lists what the layout may show', () => {
    expect(capabilitiesOf(clerkStaff, 'clerk').sort()).toEqual([...STAFF_CAPABILITIES].sort())
    expect(capabilitiesOf(principal({ claimsRole: 'event_manager' }), 'clerk')).toEqual([])
  })
})

describe('Staff in the decision core', () => {
  it('the claim opens the portal shell, and only on Stellr', () => {
    expect(portalRoleFromClaims({ metadata: { role: 'staff' } })).toBe('staff')
    expect(decidePortalAccess(clerkStaff, 'clerk').ok).toBe(true)
    expect(decidePortalAccess(pgStaff, 'postgres').ok).toBe(true)
    expect(decidePortalAccess(clerkStaff, 'clerk', CANARY_TENANT_ID).ok).toBe(false)
    expect(decidePortalAccess(principal({ memberships: [membership('staff', CANARY_TENANT_ID)] }), 'postgres', CANARY_TENANT_ID).ok).toBe(false)
  })
  it('a duty still never opens the portal', () => {
    expect(decidePortalAccess(principal({ memberships: [membership('duty_holder')] }), 'postgres').ok).toBe(false)
  })
  it('isStellrStaff reads the claim or a Stellr membership, never another tenant’s row', () => {
    expect(isStellrStaff(clerkStaff, 'clerk')).toBe(true)
    expect(isStellrStaff(pgStaff, 'postgres')).toBe(true)
    expect(isStellrStaff(principal({ memberships: [membership('staff', CANARY_TENANT_ID)] }), 'postgres')).toBe(false)
    expect(tenantRoles(principal({ memberships: [membership('staff', CANARY_TENANT_ID)] }), CANARY_TENANT_ID, 'postgres')).toEqual([])
    expect(decideTenantRole(principal({ memberships: [membership('staff', CANARY_TENANT_ID)] }), CANARY_TENANT_ID, ['staff'], 'postgres').ok).toBe(false)
    expect(decideTenantRole(pgStaff, STELLR_TENANT_ID, ['staff'], 'postgres').ok).toBe(true)
  })
  it.each([['clerk', clerkStaff], ['postgres', pgStaff]] as const)('%s: Staff covers every Stellr event without being an admin', (source, staff) => {
    const a = decideEventAccess(staff, { eventSlug: 'any-event', tenantId: STELLR_TENANT_ID, assignments: [] }, source)
    expect(a).toMatchObject({ ok: true, isAdmin: false, assignedSlugs: null, tenantId: STELLR_TENANT_ID })
    expect(decideEventAccess(staff, { eventSlug: 'x', tenantId: CANARY_TENANT_ID, assignments: [] }, source).ok).toBe(false)
  })
  it('Staff are crew: protected from view-as and deletion, by claim or membership', () => {
    expect(decideCrewTarget({ clerkRole: 'staff' }, 'clerk')).toBe(true)
    expect(decideCrewTarget({ clerkRole: undefined, memberships: [membership('staff')] }, 'postgres')).toBe(true)
  })
})

describe('pages hidden from Staff', () => {
  it.each(['/admin/duties', '/admin/duties/x', '/admin/members/access', '/admin/privacy-requests', '/admin/privacy-requests/abc', '/admin/members/123/view-as'])('%s is hidden', (path) => {
    expect(isStaffHiddenAdminPath(path)).toBe(true)
  })
  it.each(['/admin', '/admin/members', '/admin/members/123', '/admin/competitions/nv', '/admin/schools', '/admin/scholarships', '/admin/dutiesx'])('%s is not', (path) => {
    expect(isStaffHiddenAdminPath(path)).toBe(false)
  })
})
