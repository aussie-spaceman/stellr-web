import { describe, expect, it } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { CANARY_TENANT_ID, membership, principal } from '@/test/fixtures/authz-principal'
import { anonymousPrincipal, decideEventAccess, decidePortalAccess, decideCrewTarget, decideTenantRole, isStaffHiddenAdminPath, isStellrStaff, portalRoleFromClaims, tenantRoles } from './decide'
import {
  CAPABILITIES,
  STAFF_CAPABILITIES,
  STAFF_MFA_CACHE_MS,
  capabilitiesOf,
  createStaffSecondFactorCheck,
  decideCapability,
  gateStaffOnSecondFactor,
  secondFactorFromSession,
} from './capabilities'

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
      ['access:manage', 'clearance:verify', 'duties:manage', 'impersonate', 'members:delete', 'privacy:read', 'roles:manage', 'scholarships:write', 'store:write'].sort(),
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

describe('Staff needs a second factor on the session (staff-role.8)', () => {
  it('reads Clerk’s factorVerificationAge: -1 is none, a number of minutes is verified, no field is unknown', () => {
    expect(secondFactorFromSession([3, 3])).toBe('verified')
    expect(secondFactorFromSession([30, 0])).toBe('verified')
    expect(secondFactorFromSession([3, -1])).toBe('absent')
    expect(secondFactorFromSession([3, null])).toBe('absent')
    expect(secondFactorFromSession([3])).toBe('absent')
    expect(secondFactorFromSession(null)).toBe('unknown')
    expect(secondFactorFromSession(undefined)).toBe('unknown')
  })
  it('gates a Staff decision only, never an admin’s or a denial', () => {
    expect(gateStaffOnSecondFactor({ ok: true, via: 'staff' }, false)).toEqual({ ok: false, status: 403 })
    expect(gateStaffOnSecondFactor({ ok: true, via: 'staff' }, true)).toEqual({ ok: true, via: 'staff' })
    expect(gateStaffOnSecondFactor({ ok: true, via: 'admin' }, false)).toEqual({ ok: true, via: 'admin' })
    expect(gateStaffOnSecondFactor({ ok: false, status: 401 }, false)).toEqual({ ok: false, status: 401 })
  })
  it.each([['clerk', clerkStaff], ['postgres', pgStaff]] as const)('%s: capabilitiesOf drops every Staff capability without one, and keeps an admin’s', (source, staff) => {
    expect(capabilitiesOf(staff, source, STELLR_TENANT_ID, { staffSecondFactor: false })).toEqual([])
    expect(capabilitiesOf(staff, source, STELLR_TENANT_ID, { staffSecondFactor: true }).sort()).toEqual([...STAFF_CAPABILITIES].sort())
    expect(capabilitiesOf(principal({ claimsRole: 'admin' }), 'clerk', STELLR_TENANT_ID, { staffSecondFactor: false })).toEqual([...CAPABILITIES])
  })
})

describe('createStaffSecondFactorCheck', () => {
  function rig(account: () => boolean | Promise<boolean>) {
    let t = 1_000_000
    const reads: string[] = []
    const missing: string[] = []
    const check = createStaffSecondFactorCheck({
      readTwoFactorEnabled: async (id) => { reads.push(id); return account() },
      onMissing: (id) => { missing.push(id) },
      now: () => t,
    })
    return { check, reads, missing, tick: (ms: number) => { t += ms } }
  }

  it('the session decides when it can, with no Clerk read', async () => {
    const r = rig(() => true)
    expect(await r.check('u1', [2, 2])).toBe(true)
    expect(await r.check('u1', [2, -1])).toBe(false)
    expect(r.reads).toEqual([])
    expect(r.missing).toEqual(['u1'])
  })
  it('without the session field, reads the account setting and reuses it for at most 60 s', async () => {
    let on = true
    const r = rig(() => on)
    expect(await r.check('u1', null)).toBe(true)
    on = false
    r.tick(STAFF_MFA_CACHE_MS - 1)
    expect(await r.check('u1', null)).toBe(true) // still the cached read
    expect(r.reads).toHaveLength(1)
    r.tick(1)
    expect(await r.check('u1', null)).toBe(false) // a fresh read
    expect(r.reads).toHaveLength(2)
    expect(r.missing).toEqual(['u1'])
  })
  it('asks for a reconcile at most once a minute per person', async () => {
    const r = rig(() => false)
    await r.check('u1', [1, -1])
    await r.check('u1', [1, -1])
    await r.check('u2', [1, -1])
    expect(r.missing).toEqual(['u1', 'u2'])
    r.tick(STAFF_MFA_CACHE_MS)
    await r.check('u1', [1, -1])
    expect(r.missing).toEqual(['u1', 'u2', 'u1'])
  })
  it('fails closed when Clerk cannot be read, without caching that or pausing anyone', async () => {
    let down = true
    const r = rig(() => { if (down) throw new Error('clerk down'); return true })
    expect(await r.check('u1', null)).toBe(false)
    expect(r.missing).toEqual([])
    down = false
    expect(await r.check('u1', null)).toBe(true)
    expect(r.reads).toHaveLength(2)
  })
  it('a reconcile hook that throws does not fail the request', async () => {
    const check = createStaffSecondFactorCheck({ readTwoFactorEnabled: async () => false, onMissing: () => { throw new Error('boom') } })
    expect(await check('u1', [1, -1])).toBe(false)
  })
})
