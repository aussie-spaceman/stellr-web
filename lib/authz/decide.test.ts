import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { CANARY_TENANT_ID, membership, principal, USER } from '@/test/fixtures/authz-principal'
import {
  anonymousPrincipal,
  assignedSlugsInTenant,
  authzSource,
  eventAccessCovers,
  isUnrecognisedAuthzSource,
  decideEventAccess,
  decidePlatformAdmin,
  decidePortalAccess,
  decideScope,
  decideCrewTarget,
  decideStellrAdmin,
  decideTenantRole,
  decideTenantCrew,
  isEventManager,
  portalRoleFromClaims,
  roleFromClaims,
  tenantRoles,
  type EventAccess,
} from './decide'

const DENY_401 = { ok: false, status: 401 }
const DENY_403 = { ok: false, status: 403 }

describe('authzSource', () => {
  it('defaults to clerk', () => {
    expect(authzSource(undefined)).toBe('clerk')
    expect(authzSource('')).toBe('clerk')
  })
  it('accepts shadow and postgres, trimmed and in any case', () => {
    expect(authzSource('shadow')).toBe('shadow')
    expect(authzSource('postgres')).toBe('postgres')
    expect(authzSource(' Postgres ')).toBe('postgres')
    expect(authzSource('SHADOW')).toBe('shadow')
  })
  it('keeps today\'s behaviour on a typo rather than switching authority', () => {
    expect(authzSource('postgress')).toBe('clerk')
    expect(authzSource('clerk')).toBe('clerk')
  })
  it('flags a set value that is not a source, and nothing else', () => {
    expect(isUnrecognisedAuthzSource('postgress')).toBe(true)
    expect(isUnrecognisedAuthzSource(undefined)).toBe(false)
    expect(isUnrecognisedAuthzSource('  ')).toBe(false)
    for (const v of ['clerk', 'shadow', ' Postgres ']) expect(isUnrecognisedAuthzSource(v)).toBe(false)
  })
})

describe('this module is safe for proxy.ts', () => {
  it('imports nothing at runtime but the tenancy constants', () => {
    const src = readFileSync(join(process.cwd(), 'lib/authz/decide.ts'), 'utf8')
    const imports = [...src.matchAll(/^import (?!type )[^\n]* from '([^']+)'/gm)].map((m) => m[1])
    expect(imports).toEqual(['@/lib/tenancy/constants'])
  })
})

describe('claims', () => {
  it('reads metadata.role only when it is a string', () => {
    expect(roleFromClaims({ metadata: { role: 'admin' } })).toBe('admin')
    expect(roleFromClaims({ metadata: { role: 7 } })).toBeUndefined()
    expect(roleFromClaims({ metadata: {} })).toBeUndefined()
    expect(roleFromClaims({})).toBeUndefined()
    expect(roleFromClaims(null)).toBeUndefined()
    expect(roleFromClaims(undefined)).toBeUndefined()
  })
  it('portalRoleFromClaims names only the two portal roles', () => {
    expect(portalRoleFromClaims({ metadata: { role: 'admin' } })).toBe('admin')
    expect(portalRoleFromClaims({ metadata: { role: 'event_manager' } })).toBe('event_manager')
    expect(portalRoleFromClaims({ metadata: { role: 'member' } })).toBeNull()
    expect(portalRoleFromClaims({ metadata: { role: 'tenant_admin' } })).toBeNull()
    expect(portalRoleFromClaims(null)).toBeNull()
  })
})

describe('signed out', () => {
  const anon = anonymousPrincipal()
  it('is denied 401 by every decision, in both sources', () => {
    for (const s of ['clerk', 'postgres'] as const) {
      expect(decidePlatformAdmin(anon, s)).toEqual(DENY_401)
      expect(decideTenantRole(anon, STELLR_TENANT_ID, ['tenant_admin'], s)).toEqual(DENY_401)
      expect(decideStellrAdmin(anon, s)).toEqual(DENY_401)
      expect(decideTenantCrew(anon, STELLR_TENANT_ID, ['duty_holder'], s)).toEqual(DENY_401)
      expect(decidePortalAccess(anon, s)).toEqual(DENY_401)
      expect(decideEventAccess(anon, { tenantId: STELLR_TENANT_ID, assignments: [] }, s)).toEqual(DENY_401)
      expect(decideScope(anon, ['all'], 'events', s)).toBe(false)
      expect(tenantRoles(anon, STELLR_TENANT_ID, s)).toEqual([])
    }
  })
  it('is denied even with stale table fields or a claim', () => {
    const stale = { ...anon, claimsRole: 'admin', platformAdmin: true, memberships: [membership('tenant_admin')] }
    expect(decideStellrAdmin(stale, 'clerk')).toEqual(DENY_401)
    expect(decideStellrAdmin(stale, 'postgres')).toEqual(DENY_401)
    expect(decideEventAccess(stale, { tenantId: STELLR_TENANT_ID, assignments: [] }, 'postgres')).toEqual(DENY_401)
  })
})

describe('clerk source', () => {
  it('admin claim: Stellr admin, platform admin and portal, recorded as via clerk', () => {
    const p = principal({ claimsRole: 'admin' })
    const ok = { ok: true, via: 'clerk', tenantId: STELLR_TENANT_ID }
    expect(decidePlatformAdmin(p, 'clerk')).toEqual(ok)
    expect(decideStellrAdmin(p, 'clerk')).toEqual(ok)
    expect(decidePortalAccess(p, 'clerk')).toEqual(ok)
    expect(decideTenantRole(p, STELLR_TENANT_ID, ['tenant_admin'], 'clerk')).toEqual(ok)
  })
  it('ignores the table fields entirely', () => {
    const p = principal({ platformAdmin: true, memberships: [membership('tenant_admin'), membership('event_manager')] })
    expect(decideStellrAdmin(p, 'clerk')).toEqual(DENY_403)
    expect(decidePlatformAdmin(p, 'clerk')).toEqual(DENY_403)
    expect(decidePortalAccess(p, 'clerk')).toEqual(DENY_403)
    expect(decideTenantCrew(p, STELLR_TENANT_ID, ['tenant_admin'], 'clerk')).toEqual(DENY_403)
    expect(decideEventAccess(p, { tenantId: STELLR_TENANT_ID, assignments: [] }, 'clerk')).toEqual(DENY_403)
  })
  it('event_manager claim: the portal, but neither admin nor platform', () => {
    const p = principal({ claimsRole: 'event_manager' })
    expect(decidePortalAccess(p, 'clerk').ok).toBe(true)
    expect(decideStellrAdmin(p, 'clerk')).toEqual(DENY_403)
    expect(decidePlatformAdmin(p, 'clerk')).toEqual(DENY_403)
    expect(isEventManager(p, STELLR_TENANT_ID, 'clerk')).toBe(true)
  })
  it('no tenant but Stellr has claim roles', () => {
    const p = principal({ claimsRole: 'admin' })
    expect(tenantRoles(p, CANARY_TENANT_ID, 'clerk')).toEqual([])
    expect(decideTenantRole(p, CANARY_TENANT_ID, ['tenant_admin'], 'clerk')).toEqual(DENY_403)
    expect(decideEventAccess(p, { tenantId: CANARY_TENANT_ID, assignments: [] }, 'clerk')).toEqual(DENY_403)
    expect(isEventManager(principal({ claimsRole: 'event_manager' }), CANARY_TENANT_ID, 'clerk')).toBe(false)
    expect(decidePortalAccess(p, 'clerk', CANARY_TENANT_ID)).toEqual(DENY_403)
    expect(decidePortalAccess(principal({ claimsRole: 'event_manager' }), 'clerk', CANARY_TENANT_ID)).toEqual(DENY_403)
    expect(decidePlatformAdmin(p, 'clerk', CANARY_TENANT_ID)).toEqual(DENY_403)
    expect(decideScope(p, ['all'], 'events', 'clerk', CANARY_TENANT_ID)).toBe(false)
  })
  it('never reports duty_holder from a claim', () => {
    expect(tenantRoles(principal({ claimsRole: 'duty_holder' }), STELLR_TENANT_ID, 'clerk')).toEqual([])
    expect(tenantRoles(principal({ claimsRole: 'event_manager' }), STELLR_TENANT_ID, 'clerk')).toEqual(['event_manager'])
    expect(tenantRoles(principal({ claimsRole: 'admin' }), STELLR_TENANT_ID, 'clerk')).toEqual(['tenant_admin'])
  })
})

describe('postgres source', () => {
  it('the claim grants nothing: Clerk is identity only', () => {
    const p = principal({ claimsRole: 'admin' })
    expect(decideStellrAdmin(p, 'postgres')).toEqual(DENY_403)
    expect(decidePlatformAdmin(p, 'postgres')).toEqual(DENY_403)
    expect(decidePortalAccess(p, 'postgres')).toEqual(DENY_403)
    expect(decideEventAccess(p, { tenantId: STELLR_TENANT_ID, assignments: [] }, 'postgres')).toEqual(DENY_403)
  })
  it('no scope holds on another tenant, even for a platform admin', () => {
    expect(decideScope(principal({ platformAdmin: true }), ['all'], 'events', 'postgres', CANARY_TENANT_ID)).toBe(false)
  })
  it('a platform admin is a platform admin from any tenant, and via platform for Stellr', () => {
    const p = principal({ platformAdmin: true })
    expect(decidePlatformAdmin(p, 'postgres', CANARY_TENANT_ID).ok).toBe(true)
    expect(decidePlatformAdmin(p, 'postgres')).toEqual({ ok: true, via: 'platform', tenantId: STELLR_TENANT_ID })
    expect(decideStellrAdmin(p, 'postgres')).toEqual({ ok: true, via: 'platform', tenantId: STELLR_TENANT_ID })
    expect(decideTenantCrew(p, STELLR_TENANT_ID, ['tenant_admin'], 'postgres')).toEqual({ ok: true, via: 'platform', tenantId: STELLR_TENANT_ID })
  })
  it('the platform bypass stops at another tenant unless S6 support mode is on (plan decision 18)', () => {
    const normal = principal({ platformAdmin: true })
    const section = { tenantId: CANARY_TENANT_ID, assignments: [] }
    expect(decideTenantCrew(normal, CANARY_TENANT_ID, ['tenant_admin'], 'postgres')).toEqual(DENY_403)
    expect(decideEventAccess(normal, section, 'postgres')).toEqual(DENY_403)
    expect(decidePortalAccess(normal, 'postgres', CANARY_TENANT_ID)).toEqual(DENY_403)

    const support = principal({ platformAdmin: true, mode: 'support_read' })
    expect(decideTenantCrew(support, CANARY_TENANT_ID, ['tenant_admin'], 'postgres')).toEqual({ ok: true, via: 'platform', tenantId: CANARY_TENANT_ID })
    expect(decideEventAccess(support, section, 'postgres').ok).toBe(true)
    // Support mode is about the bypass; it gives nobody else anything.
    expect(decideTenantCrew(principal({ mode: 'support_read' }), CANARY_TENANT_ID, ['tenant_admin'], 'postgres')).toEqual(DENY_403)
  })
  it('a platform admin with a membership in the tenant gets in through the membership', () => {
    const p = principal({ platformAdmin: true, memberships: [membership('tenant_admin', CANARY_TENANT_ID)] })
    expect(decideTenantCrew(p, CANARY_TENANT_ID, ['tenant_admin'], 'postgres')).toEqual({ ok: true, via: 'membership', tenantId: CANARY_TENANT_ID })
  })
  it('assertTenantRole does not imply a platform admin', () => {
    expect(decideTenantRole(principal({ platformAdmin: true }), STELLR_TENANT_ID, ['tenant_admin'], 'postgres')).toEqual(DENY_403)
  })
  it('a Stellr tenant_admin is a Stellr admin via membership, but not a platform admin', () => {
    const p = principal({ memberships: [membership('tenant_admin')] })
    expect(decideStellrAdmin(p, 'postgres')).toEqual({ ok: true, via: 'membership', tenantId: STELLR_TENANT_ID })
    expect(decidePlatformAdmin(p, 'postgres')).toEqual(DENY_403)
  })
  it('a tenant_admin of another tenant is not a Stellr admin', () => {
    const p = principal({ memberships: [membership('tenant_admin', CANARY_TENANT_ID)] })
    expect(decideStellrAdmin(p, 'postgres')).toEqual(DENY_403)
    expect(decideTenantCrew(p, STELLR_TENANT_ID, ['tenant_admin'], 'postgres')).toEqual(DENY_403)
    expect(decideTenantCrew(p, CANARY_TENANT_ID, ['tenant_admin'], 'postgres')).toEqual({ ok: true, via: 'membership', tenantId: CANARY_TENANT_ID })
  })
  it('an empty role list grants nothing', () => {
    const p = principal({ memberships: [membership('tenant_admin')] })
    expect(decideTenantRole(p, STELLR_TENANT_ID, [], 'postgres')).toEqual(DENY_403)
    expect(decideTenantRole(principal({ claimsRole: 'admin' }), STELLR_TENANT_ID, [], 'clerk')).toEqual(DENY_403)
  })
  it('roles must match, not just the tenant', () => {
    const p = principal({ memberships: [membership('event_manager')] })
    expect(decideTenantRole(p, STELLR_TENANT_ID, ['tenant_admin'], 'postgres')).toEqual(DENY_403)
    expect(decideTenantRole(p, STELLR_TENANT_ID, ['tenant_admin', 'event_manager'], 'postgres').ok).toBe(true)
  })
  it('tenantRoles de-duplicates and stays inside the tenant', () => {
    const p = principal({
      memberships: [membership('duty_holder'), membership('duty_holder'), membership('tenant_admin', CANARY_TENANT_ID)],
    })
    expect(tenantRoles(p, STELLR_TENANT_ID, 'postgres')).toEqual(['duty_holder'])
  })
})

describe('staff never grants the portal', () => {
  const crew = principal({ memberships: [membership('duty_holder')] })
  it('in the postgres source', () => {
    expect(decidePortalAccess(crew, 'postgres')).toEqual(DENY_403)
    expect(decideStellrAdmin(crew, 'postgres')).toEqual(DENY_403)
    expect(decideEventAccess(crew, { tenantId: STELLR_TENANT_ID, assignments: [] }, 'postgres')).toEqual(DENY_403)
  })
  it('in the clerk source, whatever the claim says', () => {
    expect(decidePortalAccess(principal({ claimsRole: 'duty_holder' }), 'clerk')).toEqual(DENY_403)
  })
  it('but a staff membership does pass requireTenantCrew when staff is asked for', () => {
    expect(decideTenantCrew(crew, STELLR_TENANT_ID, ['duty_holder'], 'postgres').ok).toBe(true)
  })
  it('portal access is per tenant', () => {
    const p = principal({ memberships: [membership('event_manager', CANARY_TENANT_ID)] })
    expect(decidePortalAccess(p, 'postgres', STELLR_TENANT_ID)).toEqual(DENY_403)
    expect(decidePortalAccess(p, 'postgres', CANARY_TENANT_ID).ok).toBe(true)
  })
})

describe('event access', () => {
  const stellrRow = { eventSlug: 'ev-a', tenantId: STELLR_TENANT_ID }
  const nullRow = { eventSlug: 'ev-n', tenantId: null }
  const canaryRow = { eventSlug: 'ev-c', tenantId: CANARY_TENANT_ID }
  const all = [stellrRow, nullRow, canaryRow]

  it('assignedSlugsInTenant: a null tenant counts as Stellr only', () => {
    expect(assignedSlugsInTenant(all, STELLR_TENANT_ID)).toEqual(['ev-a', 'ev-n'])
    expect(assignedSlugsInTenant(all, CANARY_TENANT_ID)).toEqual(['ev-c'])
  })
  it('an event manager is confined to assignments inside the event tenant', () => {
    const p = principal({ memberships: [membership('event_manager')] })
    expect(decideEventAccess(p, { eventSlug: 'ev-a', tenantId: STELLR_TENANT_ID, assignments: all }, 'postgres')).toEqual({
      ok: true,
      userId: USER,
      isAdmin: false,
      assignedSlugs: ['ev-a', 'ev-n'],
      tenantId: STELLR_TENANT_ID,
    })
    expect(decideEventAccess(p, { eventSlug: 'ev-c', tenantId: STELLR_TENANT_ID, assignments: all }, 'postgres')).toEqual(DENY_403)
  })
  it('a membership in one tenant does not open another tenant, even with an assignment there', () => {
    const p = principal({ memberships: [membership('event_manager')] })
    expect(decideEventAccess(p, { eventSlug: 'ev-c', tenantId: CANARY_TENANT_ID, assignments: all }, 'postgres')).toEqual(DENY_403)
  })
  it('a Canary event manager reaches only the Canary assignment', () => {
    const p = principal({ memberships: [membership('event_manager', CANARY_TENANT_ID)] })
    expect(decideEventAccess(p, { eventSlug: 'ev-c', tenantId: CANARY_TENANT_ID, assignments: all }, 'postgres')).toEqual({
      ok: true,
      userId: USER,
      isAdmin: false,
      assignedSlugs: ['ev-c'],
      tenantId: CANARY_TENANT_ID,
    })
    expect(decideEventAccess(p, { eventSlug: 'ev-a', tenantId: STELLR_TENANT_ID, assignments: all }, 'postgres')).toEqual(DENY_403)
  })
  it('section-level access lists assignments and needs no slug', () => {
    const p = principal({ claimsRole: 'event_manager' })
    expect(decideEventAccess(p, { tenantId: STELLR_TENANT_ID, assignments: [stellrRow] }, 'clerk')).toEqual({
      ok: true,
      userId: USER,
      isAdmin: false,
      assignedSlugs: ['ev-a'],
      tenantId: STELLR_TENANT_ID,
    })
  })
  it('an empty slug is section-level, as in legacy', () => {
    const p = principal({ claimsRole: 'event_manager' })
    expect(decideEventAccess(p, { eventSlug: '', tenantId: STELLR_TENANT_ID, assignments: [] }, 'clerk').ok).toBe(true)
  })
  it('an admin of the event tenant sees all of that tenant; a platform admin sees all of Stellr', () => {
    const allOf = (tenantId: string) => ({ ok: true, userId: USER, isAdmin: true, assignedSlugs: null, tenantId })
    const tenantAdmin = principal({ memberships: [membership('tenant_admin', CANARY_TENANT_ID)] })
    expect(decideEventAccess(tenantAdmin, { eventSlug: 'x', tenantId: CANARY_TENANT_ID, assignments: [] }, 'postgres')).toEqual(allOf(CANARY_TENANT_ID))
    expect(decideEventAccess(tenantAdmin, { eventSlug: 'x', tenantId: STELLR_TENANT_ID, assignments: [] }, 'postgres')).toEqual(DENY_403)
    expect(decideEventAccess(principal({ platformAdmin: true }), { eventSlug: 'x', tenantId: STELLR_TENANT_ID, assignments: [] }, 'postgres')).toEqual(allOf(STELLR_TENANT_ID))
    expect(decideEventAccess(principal({ claimsRole: 'admin' }), { eventSlug: 'x', tenantId: STELLR_TENANT_ID, assignments: [] }, 'clerk')).toEqual(allOf(STELLR_TENANT_ID))
  })
  it('eventAccessCovers: an all-events answer covers only its own tenant', () => {
    const adminOfCanary = { ok: true, userId: USER, isAdmin: true, assignedSlugs: null, tenantId: CANARY_TENANT_ID } as const
    expect(eventAccessCovers(adminOfCanary, { eventSlug: 'ev-c', tenantId: CANARY_TENANT_ID })).toBe(true)
    expect(eventAccessCovers(adminOfCanary, { eventSlug: 'ev-s', tenantId: STELLR_TENANT_ID })).toBe(false)
  })
  it('eventAccessCovers: an event manager needs the assignment too, and a denial covers nothing', () => {
    const em: EventAccess = { ok: true, userId: USER, isAdmin: false, assignedSlugs: ['ev-a'], tenantId: STELLR_TENANT_ID }
    expect(eventAccessCovers(em, { eventSlug: 'ev-a', tenantId: STELLR_TENANT_ID })).toBe(true)
    expect(eventAccessCovers(em, { eventSlug: 'ev-b', tenantId: STELLR_TENANT_ID })).toBe(false)
    expect(eventAccessCovers(em, { eventSlug: 'ev-a', tenantId: CANARY_TENANT_ID })).toBe(false)
    expect(eventAccessCovers({ ok: false, status: 403 }, { eventSlug: 'ev-a', tenantId: STELLR_TENANT_ID })).toBe(false)
  })
})

describe('scopes', () => {
  it('a Stellr admin holds every scope in both sources', () => {
    expect(decideScope(principal({ claimsRole: 'admin' }), null, 'events', 'clerk')).toBe(true)
    expect(decideScope(principal({ platformAdmin: true }), null, 'events', 'postgres')).toBe(true)
    expect(decideScope(principal({ memberships: [membership('tenant_admin')] }), null, 'events', 'postgres')).toBe(true)
  })
  it('otherwise the scope or all must be held', () => {
    expect(decideScope(principal(), ['events'], 'events', 'clerk')).toBe(true)
    expect(decideScope(principal(), ['all'], 'events', 'clerk')).toBe(true)
    expect(decideScope(principal(), ['community'], 'events', 'clerk')).toBe(false)
    expect(decideScope(principal(), [], 'events', 'clerk')).toBe(false)
    expect(decideScope(principal(), null, 'events', 'clerk')).toBe(false)
  })
  it('a missing member holds nothing, whatever scopes are passed', () => {
    expect(decideScope(principal({ memberId: null }), ['all'], 'events', 'postgres')).toBe(false)
  })
  it('a tenant admin of another tenant gets no Stellr scope', () => {
    expect(decideScope(principal({ memberships: [membership('tenant_admin', CANARY_TENANT_ID)] }), null, 'events', 'postgres')).toBe(false)
  })
})

describe('staff targets', () => {
  it('clerk: the two portal roles, strings only', () => {
    expect(decideCrewTarget({ clerkRole: 'admin' }, 'clerk')).toBe(true)
    expect(decideCrewTarget({ clerkRole: 'event_manager' }, 'clerk')).toBe(true)
    expect(decideCrewTarget({ clerkRole: 'member' }, 'clerk')).toBe(false)
    expect(decideCrewTarget({ clerkRole: undefined }, 'clerk')).toBe(false)
    expect(decideCrewTarget({ clerkRole: ['admin'] }, 'clerk')).toBe(false)
  })
  it('clerk ignores table fields', () => {
    expect(decideCrewTarget({ clerkRole: undefined, platformAdmin: true, memberships: [membership('tenant_admin')] }, 'clerk')).toBe(false)
  })
  it('postgres takes the union: a portal Clerk role is protected with no table row', () => {
    expect(decideCrewTarget({ clerkRole: 'admin' }, 'postgres')).toBe(true)
    expect(decideCrewTarget({ clerkRole: 'event_manager', memberships: [] }, 'postgres')).toBe(true)
    expect(decideCrewTarget({ clerkRole: 'student', memberships: [membership('duty_holder')] }, 'postgres')).toBe(false)
  })
  it('postgres: platform admin, tenant_admin or event_manager in any tenant; staff alone is not', () => {
    expect(decideCrewTarget({ clerkRole: undefined, platformAdmin: true }, 'postgres')).toBe(true)
    expect(decideCrewTarget({ clerkRole: undefined, memberships: [membership('tenant_admin', CANARY_TENANT_ID)] }, 'postgres')).toBe(true)
    expect(decideCrewTarget({ clerkRole: undefined, memberships: [membership('event_manager')] }, 'postgres')).toBe(true)
    expect(decideCrewTarget({ clerkRole: undefined, memberships: [membership('duty_holder')] }, 'postgres')).toBe(false)
  })
})
