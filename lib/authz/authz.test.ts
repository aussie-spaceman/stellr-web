/**
 * lib/authz.ts: the source switch, failing closed, the shadow log, tenant
 * confinement through the real reads, and the page and API adapters.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { CANARY_TENANT_ID, fakeDb, MEMBER, USER, type FakeDb, type Tables } from '@/test/fixtures/authz-principal'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND')
  }),
}))

import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { resetErrorCaptureState } from '@/lib/app-errors'
import * as authz from '@/lib/authz'

let db: FakeDb

const member = { id: MEMBER, clerk_user_id: USER }
const mem = (role: string, tenant_id: string = STELLR_TENANT_ID) => ({ tenant_id, role, clerk_user_id: USER, member_id: null })

function setup(claimsRole: string | undefined, tables: Tables = {}, userId: string | null = USER) {
  db = fakeDb({ members: [member], tenants: [{ id: CANARY_TENANT_ID, status: 'active' }], ...tables })
  vi.mocked(supabaseServer).mockReturnValue(db.client)
  vi.mocked(auth).mockResolvedValue({ userId, sessionClaims: userId ? { metadata: claimsRole ? { role: claimsRole } : {} } : null } as never)
}

const source = (s: string) => vi.stubEnv('AUTHZ_SOURCE', s)

function mismatches(): string[] {
  return db.rpcs.map((c) => c.args.p_message as string)
}

beforeEach(() => {
  resetErrorCaptureState()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('defaults and stubs', () => {
  it('AUTHZ_SOURCE defaults to clerk when unset', () => {
    vi.stubEnv('AUTHZ_SOURCE', undefined as unknown as string)
    expect(authz.getAuthzSource()).toBe('clerk')
    source('nonsense')
    expect(authz.getAuthzSource()).toBe('clerk')
    source('postgres')
    expect(authz.getAuthzSource()).toBe('postgres')
  })
  it('currentTenantId is Stellr until the routing lane lands', () => {
    expect(authz.currentTenantId()).toBe(STELLR_TENANT_ID)
  })
  it('assertWritable passes in S5', () => {
    expect(() => authz.assertWritable()).not.toThrow()
  })
  it('re-exports the DB-free claim reader', () => {
    expect(authz.portalRoleFromClaims({ metadata: { role: 'admin' } })).toBe('admin')
  })
  it('the authz namespace carries the whole API', () => {
    expect(authz.authz.requireStellrAdmin).toBe(authz.requireStellrAdmin)
    expect(authz.authz.page).toBe(authz.page)
    expect(authz.authz.api).toBe(authz.api)
    expect(Object.keys(authz.authz).sort()).toEqual(
      [
        'accessCoversEvent',
        'api',
        'assertPlatformAdmin',
        'assertTenantRole',
        'assertWritable',
        'currentTenantId',
        'getAuthzSource',
        'getPrincipal',
        'hasPortalAccess',
        'hasScope',
        'isCrewTarget',
        'isCrewTargetOrUnknown',
        'isStellrAdmin',
        'isStellrAdminOrUnknown',
        'isViewAsTargetCrew',
        'page',
        'requireEventAccess',
        'requireEventCrew',
        'requireEventRoute',
        'requireStellrAdmin',
        'requireTenantCrew',
        'targetHoldsDutyRow',
      ].sort(),
    )
  })
})

describe('getPrincipal', () => {
  it('clerk: from the claim, with no database read', async () => {
    setup('admin')
    expect(await authz.getPrincipal()).toEqual({
      userId: USER,
      claimsRole: 'admin',
      memberId: null,
      platformAdmin: false,
      memberships: [],
      mode: 'normal',
    })
    expect(db.reads).toEqual([])
  })
  it('shadow: still the claim principal, with no database read', async () => {
    setup('admin')
    source('shadow')
    expect((await authz.getPrincipal()).memberId).toBeNull()
    expect(db.reads).toEqual([])
  })
  it('postgres: member, platform flag and merged memberships', async () => {
    setup(undefined, {
      platform_admins: [{ clerk_user_id: USER }],
      tenant_memberships: [
        mem('tenant_admin'),
        { tenant_id: STELLR_TENANT_ID, role: 'duty_holder', clerk_user_id: null, member_id: MEMBER },
        { tenant_id: STELLR_TENANT_ID, role: 'duty_holder', clerk_user_id: USER, member_id: MEMBER },
        { tenant_id: STELLR_TENANT_ID, role: 'owner', clerk_user_id: USER, member_id: null },
      ],
    })
    source('postgres')
    expect(await authz.getPrincipal()).toEqual({
      userId: USER,
      claimsRole: undefined,
      memberId: MEMBER,
      platformAdmin: true,
      memberships: [
        { tenantId: STELLR_TENANT_ID, role: 'tenant_admin' },
        { tenantId: STELLR_TENANT_ID, role: 'duty_holder' },
      ],
      mode: 'normal',
    })
  })
  it('postgres: signed out reads nothing', async () => {
    setup(undefined, {}, null)
    source('postgres')
    expect((await authz.getPrincipal()).userId).toBeNull()
    expect(db.reads).toEqual([])
  })
  it.each(['members', 'platform_admins', 'tenant_memberships'])('postgres: an error on %s gives the signed-out principal', async (table) => {
    setup('admin', { tenant_memberships: [mem('tenant_admin')] })
    db.fail.add(table)
    source('postgres')
    const p = await authz.getPrincipal()
    expect(p.userId).toBeNull()
    expect(p.memberships).toEqual([])
    expect(p.platformAdmin).toBe(false)
  })
  it('the principal never carries a claim for a signed-out user', async () => {
    setup(undefined, {}, null)
    // A session claim with no user id: nothing but the mock can produce this, so it must be dropped.
    vi.mocked(auth).mockResolvedValue({ userId: null, sessionClaims: { metadata: { role: 'admin' } } } as never)
    expect((await authz.getPrincipal()).claimsRole).toBeUndefined()
  })
  it('postgres: a membership in a suspended or archived tenant grants nothing', async () => {
    for (const status of ['suspended', 'archived']) {
      setup(undefined, {
        tenants: [{ id: CANARY_TENANT_ID, status }],
        tenant_memberships: [mem('tenant_admin', CANARY_TENANT_ID), mem('duty_holder')],
      })
      source('postgres')
      expect(await authz.getPrincipal()).toMatchObject({ memberships: [{ tenantId: STELLR_TENANT_ID, role: 'duty_holder' }] })
      expect((await authz.requireTenantCrew(CANARY_TENANT_ID, ['tenant_admin'])).ok).toBe(false)
    }
  })
  it('postgres: active and provisioning tenants keep their memberships', async () => {
    for (const status of ['active', 'provisioning']) {
      setup(undefined, { tenants: [{ id: CANARY_TENANT_ID, status }], tenant_memberships: [mem('tenant_admin', CANARY_TENANT_ID)] })
      source('postgres')
      expect((await authz.requireTenantCrew(CANARY_TENANT_ID, ['tenant_admin'])).ok).toBe(true)
    }
  })
  it('postgres: a tenant status read error denies', async () => {
    setup(undefined, { tenant_memberships: [mem('tenant_admin', CANARY_TENANT_ID)] })
    db.fail.add('tenants')
    source('postgres')
    expect(await authz.requireTenantCrew(CANARY_TENANT_ID, ['tenant_admin'])).toEqual({ ok: false, status: 403 })
  })
  it('postgres: a Stellr-only principal reads no tenant status', async () => {
    setup(undefined, { tenant_memberships: [mem('tenant_admin')] })
    source('postgres')
    await authz.getPrincipal()
    expect(db.reads).not.toContain('tenants')
  })
})

describe('postgres fails closed', () => {
  const admin = { tenant_memberships: [mem('tenant_admin')], platform_admins: [{ clerk_user_id: USER }] }
  const em = {
    tenant_memberships: [mem('event_manager')],
    event_manager_assignments: [{ clerk_user_id: USER, event_slug: 'ev-a', tenant_id: STELLR_TENANT_ID }],
  }

  it.each(['members', 'platform_admins', 'tenant_memberships'])('a read error on %s denies everything, even a Clerk admin holding every row', async (table) => {
    setup('admin', admin)
    db.fail.add(table)
    source('postgres')
    expect(await authz.requireStellrAdmin()).toEqual({ ok: false, status: 403 })
    expect(await authz.assertPlatformAdmin()).toEqual({ ok: false, status: 403 })
    expect(await authz.assertTenantRole(STELLR_TENANT_ID, ['tenant_admin'])).toEqual({ ok: false, status: 403 })
    expect(await authz.requireTenantCrew(STELLR_TENANT_ID, ['tenant_admin'])).toEqual({ ok: false, status: 403 })
    expect(await authz.isStellrAdmin()).toBe(false)
    expect(await authz.hasPortalAccess()).toBe(false)
    expect(await authz.hasScope('events')).toBe(false)
    expect(await authz.requireEventAccess('ev-a')).toEqual({ ok: false, status: 403 })
  })
  it('an assignment read error denies an event manager', async () => {
    setup(undefined, em)
    db.fail.add('event_manager_assignments')
    source('postgres')
    expect(await authz.requireEventAccess('ev-a')).toEqual({ ok: false, status: 403 })
    expect(await authz.requireEventAccess()).toEqual({ ok: false, status: 403 })
  })
  it('an event tenant lookup failure denies', async () => {
    setup(undefined, em)
    db.fail.add('events')
    source('postgres')
    expect(await authz.requireEventAccess('ev-a')).toEqual({ ok: false, status: 403 })
  })
  it('a Stellr admin is not waved onto another tenant\'s event while the events read is down', async () => {
    setup(undefined, { tenant_memberships: [mem('tenant_admin')], events: [{ slug: 'ev-c', tenant_id: CANARY_TENANT_ID }] })
    source('postgres')
    expect(await authz.requireEventAccess('ev-c')).toEqual({ ok: false, status: 403 })
    db.fail.add('events')
    expect(await authz.requireEventAccess('ev-c')).toEqual({ ok: false, status: 403 })
  })
  it('an event the mirror does not hold is Stellr\'s', async () => {
    setup(undefined, { tenant_memberships: [mem('tenant_admin')], events: [] })
    source('postgres')
    expect(await authz.requireEventAccess('ev-new')).toEqual({ ok: true, userId: USER, isAdmin: true, assignedSlugs: null, tenantId: STELLR_TENANT_ID })
  })
  it('a staff-target lookup error counts as staff, so view-as and deletion are refused', async () => {
    setup(undefined, {})
    db.fail.add('tenant_memberships')
    source('postgres')
    expect(await authz.isCrewTarget({ clerkUserId: 'user_other', clerkRole: undefined })).toBe(true)
  })
  it('an admin_duties read error is no scope', async () => {
    setup(undefined, { admin_duties: [{ member_id: MEMBER, scopes: ['all'] }] })
    db.fail.add('admin_duties')
    source('postgres')
    expect(await authz.hasScope('events')).toBe(false)
  })
  it('a missing member holds no member-keyed role and no scope', async () => {
    setup(undefined, {
      members: [],
      tenant_memberships: [{ tenant_id: STELLR_TENANT_ID, role: 'tenant_admin', clerk_user_id: null, member_id: MEMBER }],
      admin_duties: [{ member_id: MEMBER, scopes: ['all'] }],
    })
    source('postgres')
    expect(await authz.isStellrAdmin()).toBe(false)
    expect(await authz.hasScope('events')).toBe(false)
    expect(await authz.hasPortalAccess()).toBe(false)
    expect((await authz.getPrincipal()).memberId).toBeNull()
  })
  it('a missing member still holds a Clerk-keyed role', async () => {
    setup(undefined, { members: [], tenant_memberships: [mem('tenant_admin')] })
    source('postgres')
    expect(await authz.isStellrAdmin()).toBe(true)
  })
  it('signed out is 401, not 403', async () => {
    setup(undefined, {}, null)
    source('postgres')
    expect(await authz.requireStellrAdmin()).toEqual({ ok: false, status: 401 })
    expect(await authz.requireEventAccess('ev-a')).toEqual({ ok: false, status: 401 })
    expect(await authz.hasScope('events')).toBe(false)
  })
  it('a staff target with no Clerk id cannot be looked up, and is judged without reading', async () => {
    setup(undefined, {})
    source('postgres')
    expect(await authz.isCrewTarget({ clerkUserId: null, clerkRole: 'admin' })).toBe(true)
    expect(await authz.isCrewTarget({ clerkUserId: null, clerkRole: undefined })).toBe(false)
    expect(db.reads).toEqual([])
  })
})

describe('clerk keeps today\'s failure shape', () => {
  it('an assignment read error throws, as lib/event-access does', async () => {
    setup('event_manager')
    db.fail.add('event_manager_assignments')
    await expect(authz.requireEventAccess('ev-a')).rejects.toThrow('Failed to load event assignments')
  })
  it('never looks up the event tenant', async () => {
    setup('event_manager', { event_manager_assignments: [{ clerk_user_id: USER, event_slug: 'ev-a' }] })
    expect((await authz.requireEventAccess('ev-a')).ok).toBe(true)
    expect(db.reads).not.toContain('events')
  })
  it('a non-event-manager is refused without an assignment read', async () => {
    setup('student')
    expect(await authz.requireEventAccess('ev-a')).toEqual({ ok: false, status: 403 })
    expect(db.reads).toEqual([])
  })
})

describe('tenant confinement through the real reads', () => {
  const rows = [
    { clerk_user_id: USER, event_slug: 'ev-s', tenant_id: STELLR_TENANT_ID },
    { clerk_user_id: USER, event_slug: 'ev-c', tenant_id: CANARY_TENANT_ID },
    { clerk_user_id: 'user_other', event_slug: 'ev-x', tenant_id: STELLR_TENANT_ID },
  ]
  it('the event tenant decides, and only assignments there count', async () => {
    setup(undefined, {
      tenant_memberships: [mem('event_manager', CANARY_TENANT_ID)],
      event_manager_assignments: rows,
      events: [
        { slug: 'ev-c', tenant_id: CANARY_TENANT_ID },
        { slug: 'ev-s', tenant_id: STELLR_TENANT_ID },
      ],
    })
    source('postgres')
    expect(await authz.requireEventAccess('ev-c')).toEqual({ ok: true, userId: USER, isAdmin: false, assignedSlugs: ['ev-c'], tenantId: CANARY_TENANT_ID })
    expect(await authz.requireEventAccess('ev-s')).toEqual({ ok: false, status: 403 })
  })
  it('section access uses the current tenant, with no event lookup', async () => {
    setup(undefined, { tenant_memberships: [mem('event_manager')], event_manager_assignments: rows })
    source('postgres')
    expect(await authz.requireEventAccess()).toEqual({ ok: true, userId: USER, isAdmin: false, assignedSlugs: ['ev-s'], tenantId: STELLR_TENANT_ID })
    expect(db.reads).not.toContain('events')
  })
  it('a non-manager reads no assignments under postgres', async () => {
    setup(undefined, { tenant_memberships: [mem('duty_holder')], event_manager_assignments: rows })
    source('postgres')
    expect(await authz.requireEventAccess('ev-s')).toEqual({ ok: false, status: 403 })
    expect(db.reads).not.toContain('event_manager_assignments')
  })
  it('an admin reads no assignments', async () => {
    setup(undefined, { tenant_memberships: [mem('tenant_admin')], event_manager_assignments: rows })
    source('postgres')
    expect(await authz.requireEventAccess('ev-s')).toEqual({ ok: true, userId: USER, isAdmin: true, assignedSlugs: null, tenantId: STELLR_TENANT_ID })
    expect(db.reads).not.toContain('event_manager_assignments')
  })
  it('a Canary tenant_admin is refused on a Stellr event, and has no Stellr admin', async () => {
    setup(undefined, { tenant_memberships: [mem('tenant_admin', CANARY_TENANT_ID)] })
    source('postgres')
    expect(await authz.requireEventAccess('ev-s')).toEqual({ ok: false, status: 403 })
    expect(await authz.isStellrAdmin()).toBe(false)
    expect((await authz.assertTenantRole(CANARY_TENANT_ID, ['tenant_admin'])).ok).toBe(true)
    expect((await authz.requireTenantCrew(CANARY_TENANT_ID, ['tenant_admin'])).ok).toBe(true)
  })
  it('a staff target is found through the member row too', async () => {
    setup(undefined, {
      members: [{ id: MEMBER, clerk_user_id: 'user_target' }],
      tenant_memberships: [{ tenant_id: STELLR_TENANT_ID, role: 'event_manager', clerk_user_id: null, member_id: MEMBER }],
    })
    source('postgres')
    expect(await authz.isCrewTarget({ clerkUserId: 'user_target', clerkRole: undefined })).toBe(true)
    expect(await authz.isCrewTarget({ clerkUserId: 'user_nobody', clerkRole: undefined })).toBe(false)
  })
  it('a Clerk admin with no mapped row stays protected from view-as and deletion', async () => {
    setup(undefined, {})
    source('postgres')
    expect(await authz.isCrewTarget({ clerkUserId: 'user_nobody', clerkRole: 'admin' })).toBe(true)
    expect(await authz.isCrewTarget({ clerkUserId: 'user_nobody', clerkRole: 'event_manager' })).toBe(true)
  })
  it('a target with no Clerk id is found through a member id', async () => {
    setup(undefined, {
      tenant_memberships: [{ tenant_id: STELLR_TENANT_ID, role: 'tenant_admin', clerk_user_id: null, member_id: MEMBER }],
    })
    source('postgres')
    expect(await authz.isCrewTarget({ clerkUserId: null, memberId: MEMBER, clerkRole: undefined })).toBe(true)
    expect(db.reads).not.toContain('platform_admins')
    expect(await authz.isCrewTarget({ clerkUserId: null, memberId: '22222222-2222-4222-8222-222222222222', clerkRole: undefined })).toBe(false)
  })
  it('a suspended tenant\'s admin stays protected', async () => {
    setup(undefined, {
      tenants: [{ id: CANARY_TENANT_ID, status: 'suspended' }],
      tenant_memberships: [mem('tenant_admin', CANARY_TENANT_ID)],
    })
    source('postgres')
    expect(await authz.isCrewTarget({ clerkUserId: USER, clerkRole: undefined })).toBe(true)
  })
})

describe('shadow', () => {
  it('agreement: the clerk answer and no log', async () => {
    setup('admin', { tenant_memberships: [mem('tenant_admin')] })
    source('shadow')
    expect(await authz.isStellrAdmin({ route: '/api/admin/x' })).toBe(true)
    expect(db.rpcs).toEqual([])
  })
  it('clerk allows, postgres denies: the clerk answer stands and the mismatch is logged', async () => {
    setup('admin', {})
    source('shadow')
    expect(await authz.requireStellrAdmin({ route: '/api/admin/x' })).toEqual({ ok: true, via: 'clerk', tenantId: STELLR_TENANT_ID })
    expect(mismatches()).toEqual([`authz_mismatch stellr_admin member=${MEMBER} clerk=allow postgres=deny_403`])
    expect(db.rpcs[0].fn).toBe('record_app_error')
    expect(db.rpcs[0].args.p_route).toBe('AUTHZ /api/admin/x')
    expect(db.rpcs[0].args.p_count).toBe(1)
  })
  it('clerk denies, postgres allows: still denied, and logged', async () => {
    setup('student', { tenant_memberships: [mem('tenant_admin')] })
    source('shadow')
    expect(await authz.isStellrAdmin()).toBe(false)
    expect(mismatches()).toEqual([`authz_mismatch stellr_admin member=${MEMBER} clerk=deny_403 postgres=allow`])
    expect(db.rpcs[0].args.p_route).toBe('AUTHZ unknown')
  })
  it('a member-less user logs member=none', async () => {
    setup('admin', { members: [] })
    source('shadow')
    await authz.isStellrAdmin()
    expect(mismatches()).toEqual(['authz_mismatch stellr_admin member=none clerk=allow postgres=deny_403'])
  })
  it('a postgres lookup failure never denies, and is logged as lookup_failed', async () => {
    setup('admin', { tenant_memberships: [mem('tenant_admin')] })
    db.fail.add('tenant_memberships')
    source('shadow')
    expect(await authz.isStellrAdmin()).toBe(true)
    expect(mismatches()).toEqual(['authz_mismatch stellr_admin member=unknown lookup_failed'])
  })
  it('a non-lookup failure is logged as error', async () => {
    setup('event_manager', { tenant_memberships: [mem('event_manager')], event_manager_assignments: [{ clerk_user_id: USER, event_slug: 'ev-a', tenant_id: STELLR_TENANT_ID }] })
    const realFrom = db.client.from.bind(db.client)
    db.client.from = ((table: string) => {
      if (table === 'events') throw new Error('down')
      return realFrom(table)
    }) as typeof db.client.from
    source('shadow')
    expect((await authz.requireEventAccess('ev-a')).ok).toBe(true)
    expect(mismatches()).toEqual([`authz_mismatch event_access member=${MEMBER} error`])
  })
  it('a real members.id survives into the row (the app_errors scrubber would make it [token])', async () => {
    const real = '3f2a9c10-7b4e-4d21-9a6f-0c1d2e3f4a5b'
    setup('admin', { members: [{ id: real, clerk_user_id: USER }] })
    source('shadow')
    await authz.isStellrAdmin()
    expect(mismatches()).toEqual([`authz_mismatch stellr_admin member=${real} clerk=allow postgres=deny_403`])
  })
  it('a member id that is not a uuid is not written', async () => {
    setup('admin', { members: [{ id: 'not-a-uuid', clerk_user_id: USER }] })
    source('shadow')
    await authz.isStellrAdmin()
    expect(mismatches()).toEqual(['authz_mismatch stellr_admin member=unknown clerk=allow postgres=deny_403'])
  })
  it('repeats of one mismatch are rate limited like every app_errors write', async () => {
    setup('admin', {})
    source('shadow')
    await authz.isStellrAdmin()
    await authz.isStellrAdmin()
    expect(db.rpcs).toHaveLength(1)
  })
  it('a failed write never reaches the caller', async () => {
    setup('admin', {})
    source('shadow')
    ;(db.client as unknown as { rpc: unknown }).rpc = async () => {
      throw new Error('down')
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await authz.isStellrAdmin()).toBe(true)
    expect(spy).toHaveBeenCalledWith('[authz] mismatch record failed')
    spy.mockRestore()
  })
  it('the log carries no Clerk id, email or slug', async () => {
    setup('event_manager', { tenant_memberships: [mem('event_manager')], event_manager_assignments: [{ clerk_user_id: USER, event_slug: 'ev-secret', tenant_id: CANARY_TENANT_ID }] })
    source('shadow')
    await authz.requireEventAccess('ev-secret')
    const logged = mismatches().join(' ')
    expect(logged).toContain('authz_mismatch event_access')
    expect(logged).not.toContain(USER)
    expect(logged).not.toContain('ev-secret')
  })
  it('event access compares the assignment list, not just ok', async () => {
    setup('event_manager', {
      tenant_memberships: [mem('event_manager')],
      event_manager_assignments: [
        { clerk_user_id: USER, event_slug: 'ev-a', tenant_id: STELLR_TENANT_ID },
        { clerk_user_id: USER, event_slug: 'ev-c', tenant_id: CANARY_TENANT_ID },
      ],
    })
    source('shadow')
    expect(await authz.requireEventAccess()).toEqual({ ok: true, userId: USER, isAdmin: false, assignedSlugs: ['ev-a', 'ev-c'], tenantId: STELLR_TENANT_ID })
    expect(mismatches()).toEqual([`authz_mismatch event_access member=${MEMBER} clerk=assigned_2 postgres=assigned_1`])
  })
  it('event access compares isAdmin and all-events', async () => {
    setup('admin', { tenant_memberships: [mem('event_manager')], event_manager_assignments: [{ clerk_user_id: USER, event_slug: 'ev-a', tenant_id: STELLR_TENANT_ID }] })
    source('shadow')
    expect(await authz.requireEventAccess()).toEqual({ ok: true, userId: USER, isAdmin: true, assignedSlugs: null, tenantId: STELLR_TENANT_ID })
    expect(mismatches()).toEqual([`authz_mismatch event_access member=${MEMBER} clerk=all postgres=assigned_1`])
  })
  it('event access denial status counts', async () => {
    setup('student', {})
    source('shadow')
    expect(await authz.requireEventAccess('ev-a')).toEqual({ ok: false, status: 403 })
    expect(db.rpcs).toEqual([])
  })
  it('boolean decisions log true and false', async () => {
    setup('event_manager', {})
    source('shadow')
    expect(await authz.hasPortalAccess()).toBe(true)
    expect(mismatches()).toEqual([`authz_mismatch portal member=${MEMBER} clerk=true postgres=false`])
  })
  it('primitives shadow too', async () => {
    setup('admin', {})
    source('shadow')
    expect((await authz.assertPlatformAdmin()).ok).toBe(true)
    expect((await authz.assertTenantRole(STELLR_TENANT_ID, ['tenant_admin'])).ok).toBe(true)
    expect((await authz.requireTenantCrew(STELLR_TENANT_ID, ['tenant_admin'])).ok).toBe(true)
    expect(mismatches().map((m) => m.split(' ')[1])).toEqual(['platform_admin', 'tenant_role', 'tenant_crew'])
  })
  it('scope and staff target shadow too', async () => {
    setup('admin', { tenant_memberships: [mem('event_manager')] })
    source('shadow')
    expect(await authz.hasScope('events')).toBe(true)
    expect(await authz.isCrewTarget({ clerkUserId: USER, clerkRole: undefined })).toBe(false)
    expect(mismatches().map((m) => m.split(' ')[1])).toEqual(['scope', 'crew_target'])
  })
  it('a staff-target mismatch names the target, not the admin asking', async () => {
    const target = '22222222-2222-4222-8222-222222222222'
    setup('admin', {
      members: [member, { id: target, clerk_user_id: 'user_target' }],
      tenant_memberships: [{ tenant_id: STELLR_TENANT_ID, role: 'event_manager', clerk_user_id: 'user_target', member_id: null }],
    })
    source('shadow')
    await authz.isCrewTarget({ clerkUserId: 'user_target', clerkRole: undefined })
    expect(mismatches()).toEqual([`authz_mismatch crew_target member=${target} clerk=false postgres=true`])
    expect(mismatches().join(' ')).not.toContain(MEMBER)
  })
  it('a staff-target lookup failure in shadow does not throw, and names the target when it can', async () => {
    setup(undefined, {})
    db.fail.add('tenant_memberships')
    source('shadow')
    expect(await authz.isCrewTarget({ clerkUserId: USER, clerkRole: undefined })).toBe(false)
    expect(mismatches()).toEqual([`authz_mismatch crew_target member=${MEMBER} lookup_failed`])
  })
  it('two drifted members get a row each, so the role-sync check can list them', async () => {
    const other = '22222222-2222-4222-8222-222222222222'
    source('shadow')
    setup('admin', { tenant_memberships: [{ tenant_id: STELLR_TENANT_ID, role: 'event_manager', clerk_user_id: null, member_id: MEMBER }] })
    await authz.isCrewTarget({ clerkUserId: null, memberId: MEMBER, clerkRole: undefined })
    const first = db.rpcs[0]
    setup('admin', { tenant_memberships: [{ tenant_id: STELLR_TENANT_ID, role: 'event_manager', clerk_user_id: null, member_id: other }] })
    await authz.isCrewTarget({ clerkUserId: null, memberId: other, clerkRole: undefined })
    const second = db.rpcs[0]
    expect(first.args.p_message).toContain(MEMBER)
    expect(second.args.p_message).toContain(other)
    expect(second.args.p_digest).not.toBe(first.args.p_digest)
  })
  it('a member\'s own repeats still share one row', async () => {
    setup('admin', {})
    source('shadow')
    await authz.isStellrAdmin({ route: '/a' })
    const first = db.rpcs[0].args.p_digest
    resetErrorCaptureState()
    await authz.isStellrAdmin({ route: '/a' })
    expect(db.rpcs[1].args.p_digest).toBe(first)
  })
  it('event access flags a tenant the two sources disagree on', async () => {
    setup('admin', {
      tenant_memberships: [mem('tenant_admin', CANARY_TENANT_ID)],
      events: [{ slug: 'ev-c', tenant_id: CANARY_TENANT_ID }],
    })
    source('shadow')
    expect(await authz.requireEventAccess('ev-c')).toEqual({ ok: true, userId: USER, isAdmin: true, assignedSlugs: null, tenantId: STELLR_TENANT_ID })
    expect(mismatches()).toEqual([`authz_mismatch event_access member=${MEMBER} clerk=all postgres=all_other_tenant`])
  })
})

describe('an unrecognised AUTHZ_SOURCE', () => {
  it('stays clerk and leaves a row, with fixed text and never the value', async () => {
    setup('admin')
    source('postgress')
    expect(await authz.isStellrAdmin()).toBe(true)
    expect(db.reads).toEqual([])
    expect(mismatches()).toEqual(['authz_source_unrecognised using=clerk'])
    expect(db.rpcs[0].args.p_route).toBe('AUTHZ config')
    expect(JSON.stringify(db.rpcs[0].args)).not.toContain('postgress')
  })
  it('is rate limited like every other row', async () => {
    setup('admin')
    source('postgress')
    await authz.isStellrAdmin()
    await authz.isStellrAdmin()
    expect(db.rpcs).toHaveLength(1)
  })
  it('a failed write never reaches the caller', async () => {
    setup('admin')
    source('postgress')
    vi.mocked(supabaseServer).mockImplementation(() => {
      throw new Error('down')
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await authz.isStellrAdmin()).toBe(true)
    spy.mockRestore()
    vi.mocked(supabaseServer).mockReset()
  })
  it.each([undefined, '', 'clerk'])('%s writes nothing', async (value) => {
    setup('admin')
    vi.stubEnv('AUTHZ_SOURCE', value as string)
    await authz.isStellrAdmin()
    expect(db.rpcs).toEqual([])
  })
})

describe('accessCoversEvent', () => {
  it('a section-level answer covers its tenant\'s events and not another tenant\'s', async () => {
    setup('admin', { events: [{ slug: 'ev-c', tenant_id: CANARY_TENANT_ID }, { slug: 'ev-s', tenant_id: STELLR_TENANT_ID }] })
    const access = await authz.requireEventAccess()
    expect(await authz.accessCoversEvent(access, 'ev-s')).toBe(true)
    expect(await authz.accessCoversEvent(access, 'ev-c')).toBe(false)
  })
  it('a read error covers nothing, and a denial reads nothing', async () => {
    setup('admin', { events: [{ slug: 'ev-s', tenant_id: STELLR_TENANT_ID }] })
    const access = await authz.requireEventAccess()
    db.fail.add('events')
    expect(await authz.accessCoversEvent(access, 'ev-s')).toBe(false)
    db.reads.length = 0
    expect(await authz.accessCoversEvent({ ok: false, status: 403 }, 'ev-s')).toBe(false)
    expect(db.reads).toEqual([])
  })
})

describe('hasScope', () => {
  it('clerk: admin_duties still decides for a non-admin, as today', async () => {
    setup(undefined, { admin_duties: [{ member_id: MEMBER, scopes: ['events'] }] })
    expect(await authz.hasScope('events')).toBe(true)
    expect(await authz.hasScope('community')).toBe(false)
  })
  it('clerk: read errors are no scope, as today', async () => {
    setup(undefined, { admin_duties: [{ member_id: MEMBER, scopes: ['all'] }] })
    db.fail.add('members')
    expect(await authz.hasScope('events')).toBe(false)
    setup(undefined, { admin_duties: [{ member_id: MEMBER, scopes: ['all'] }] })
    db.fail.add('admin_duties')
    expect(await authz.hasScope('events')).toBe(false)
  })
  it('clerk: an admin needs no read', async () => {
    setup('admin')
    expect(await authz.hasScope('events')).toBe(true)
    expect(db.reads).toEqual([])
  })
})

describe('isStellrAdminOrUnknown', () => {
  it('under clerk and shadow is the Clerk answer, and never null', async () => {
    db = fakeDb({})
    for (const source of ['', 'clerk', 'shadow']) {
      vi.stubEnv('AUTHZ_SOURCE', source)
      db.fail.add('members')
      vi.mocked(auth).mockResolvedValue({ userId: USER, sessionClaims: { metadata: { role: 'admin' } } } as never)
      expect(await authz.isStellrAdminOrUnknown(), source).toBe(true)
      vi.mocked(auth).mockResolvedValue({ userId: USER, sessionClaims: { metadata: { role: 'event_manager' } } } as never)
      expect(await authz.isStellrAdminOrUnknown(), source).toBe(false)
    }
  })

  it('under postgres answers from the tables, and is null only when they cannot be read', async () => {
    vi.stubEnv('AUTHZ_SOURCE', 'postgres')
    vi.mocked(auth).mockResolvedValue({ userId: USER, sessionClaims: { metadata: { role: 'admin' } } } as never)
    db = fakeDb({ members: [{ id: MEMBER, clerk_user_id: USER }], tenant_memberships: [{ tenant_id: STELLR_TENANT_ID, role: 'tenant_admin', clerk_user_id: USER }] })
    vi.mocked(supabaseServer).mockReturnValue(db.client)
    expect(await authz.isStellrAdminOrUnknown()).toBe(true)
    db.tables.tenant_memberships = []
    expect(await authz.isStellrAdminOrUnknown()).toBe(false)
    db.fail.add('tenant_memberships')
    expect(await authz.isStellrAdminOrUnknown()).toBeNull()
    expect(await authz.isStellrAdmin()).toBe(false)
  })
})

describe('isCrewTargetOrUnknown', () => {
  const target = { clerkUserId: USER, clerkRole: 'student', memberId: MEMBER }

  it('under postgres tells a failed read from a staff answer, where isCrewTarget cannot', async () => {
    vi.stubEnv('AUTHZ_SOURCE', 'postgres')
    db = fakeDb({ tenant_memberships: [{ tenant_id: STELLR_TENANT_ID, role: 'event_manager', member_id: MEMBER }] })
    vi.mocked(supabaseServer).mockReturnValue(db.client)
    expect(await authz.isCrewTargetOrUnknown(target)).toBe(true)
    db.tables.tenant_memberships = []
    expect(await authz.isCrewTargetOrUnknown(target)).toBe(false)
    db.fail.add('tenant_memberships')
    expect(await authz.isCrewTargetOrUnknown(target)).toBeNull()
    expect(await authz.isCrewTarget(target)).toBe(true)
  })

  it('under clerk and shadow is the Clerk answer, and never null', async () => {
    db = fakeDb({})
    vi.mocked(supabaseServer).mockReturnValue(db.client)
    db.fail.add('tenant_memberships')
    for (const source of ['', 'clerk', 'shadow']) {
      vi.stubEnv('AUTHZ_SOURCE', source)
      expect(await authz.isCrewTargetOrUnknown(target), source).toBe(false)
      expect(await authz.isCrewTargetOrUnknown({ ...target, clerkRole: 'admin' }), source).toBe(true)
    }
  })
})

describe('page adapters', () => {
  it.each(['clerk', 'postgres'])('%s: signed out goes to sign-in', async (s) => {
    setup(undefined, {}, null)
    source(s)
    await expect(authz.page.requireAdmin()).rejects.toThrow('REDIRECT /sign-in')
    await expect(authz.page.requireStellrAdmin()).rejects.toThrow('REDIRECT /sign-in')
  })
  it('requireAdmin admits an event manager; requireStellrAdmin does not', async () => {
    setup('event_manager')
    await expect(authz.page.requireAdmin()).resolves.toBeUndefined()
    await expect(authz.page.requireStellrAdmin()).rejects.toThrow('NOT_FOUND')
  })
  it('a signed-in non-staff user gets notFound', async () => {
    setup('student')
    await expect(authz.page.requireAdmin()).rejects.toThrow('NOT_FOUND')
    await expect(authz.page.requireStellrAdmin()).rejects.toThrow('NOT_FOUND')
  })
  it('an admin passes both', async () => {
    setup('admin')
    await expect(authz.page.requireAdmin()).resolves.toBeUndefined()
    await expect(authz.page.requireStellrAdmin()).resolves.toBeUndefined()
  })
  it('requireTenantAdmin and requireEventSection, by claim', async () => {
    setup('admin')
    await expect(authz.page.requireTenantAdmin()).resolves.toBeUndefined()
    await expect(authz.page.requireEventSection()).resolves.toBeUndefined()
    setup('event_manager')
    await expect(authz.page.requireTenantAdmin()).rejects.toThrow('NOT_FOUND')
    await expect(authz.page.requireEventSection()).resolves.toBeUndefined()
    setup('student')
    await expect(authz.page.requireTenantAdmin()).rejects.toThrow('NOT_FOUND')
    await expect(authz.page.requireEventSection()).rejects.toThrow('NOT_FOUND')
    setup(undefined, {}, null)
    await expect(authz.page.requireTenantAdmin()).rejects.toThrow('REDIRECT /sign-in')
    await expect(authz.page.requireEventSection()).rejects.toThrow('REDIRECT /sign-in')
  })
  it('postgres: a claim of admin with only an event_manager row is confined by the tenant-admin guard', async () => {
    setup('admin', { tenant_memberships: [mem('event_manager')] })
    source('postgres')
    await expect(authz.page.requireTenantAdmin()).rejects.toThrow('NOT_FOUND')
    await expect(authz.page.requireEventSection()).resolves.toBeUndefined()
    // The known gap: proxy.ts sees the claim, so this guard alone does not confine them. See its comment.
    await expect(authz.page.requireAdmin()).resolves.toBeUndefined()
  })
  it('postgres: a staff member gets notFound, and a read error gets notFound', async () => {
    setup(undefined, { tenant_memberships: [mem('duty_holder')] })
    source('postgres')
    await expect(authz.page.requireAdmin()).rejects.toThrow('NOT_FOUND')
    setup('admin', { tenant_memberships: [mem('tenant_admin')] })
    db.fail.add('tenant_memberships')
    await expect(authz.page.requireAdmin()).rejects.toThrow('NOT_FOUND')
    await expect(authz.page.requireStellrAdmin()).rejects.toThrow('NOT_FOUND')
  })
})

describe('api adapters', () => {
  async function body(r: { ok: boolean; deny?: Response }) {
    expect(r.ok).toBe(false)
    return { status: r.deny!.status, json: await r.deny!.json() }
  }
  it('signed out is 401 Unauthorised', async () => {
    setup(undefined, {}, null)
    expect(await body(await authz.api.requireStellrAdmin())).toEqual({ status: 401, json: { error: 'Unauthorised' } })
    expect(await body(await authz.api.requireEventAccess('ev-a'))).toEqual({ status: 401, json: { error: 'Unauthorised' } })
    expect(await body(await authz.api.requireTenantCrew(STELLR_TENANT_ID, ['duty_holder']))).toEqual({ status: 401, json: { error: 'Unauthorised' } })
  })
  it('signed in without access is 403 Forbidden', async () => {
    setup('student')
    expect(await body(await authz.api.requireStellrAdmin())).toEqual({ status: 403, json: { error: 'Forbidden' } })
    expect(await body(await authz.api.requireEventAccess('ev-a'))).toEqual({ status: 403, json: { error: 'Forbidden' } })
    expect(await body(await authz.api.requireTenantCrew(STELLR_TENANT_ID, ['tenant_admin']))).toEqual({ status: 403, json: { error: 'Forbidden' } })
  })
  it('allowed returns the decision', async () => {
    setup('admin')
    expect(await authz.api.requireStellrAdmin()).toEqual({ ok: true, value: { ok: true, via: 'clerk', tenantId: STELLR_TENANT_ID } })
    expect(await authz.api.requireTenantCrew(STELLR_TENANT_ID, ['tenant_admin'])).toEqual({ ok: true, value: { ok: true, via: 'clerk', tenantId: STELLR_TENANT_ID } })
    expect(await authz.api.requireEventAccess('ev-a')).toEqual({ ok: true, value: { ok: true, userId: USER, isAdmin: true, assignedSlugs: null, tenantId: STELLR_TENANT_ID } })
  })
})
