/**
 * lib/authz with the request on another tenant's host: what the routing lane
 * turns on when currentTenantId() stops being a stub. Clerk refuses everything
 * there; postgres confines each answer to the tenant, so a section-level answer
 * on tenant B's host never covers a Stellr row.
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
vi.mock('@/lib/authz/tenant', () => ({ currentTenantId: vi.fn() }))

import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { resetErrorCaptureState } from '@/lib/app-errors'
import { currentTenantId } from '@/lib/authz/tenant'
import * as authz from '@/lib/authz'

let db: FakeDb

const mem = (role: string, tenant_id: string = STELLR_TENANT_ID) => ({ tenant_id, role, clerk_user_id: USER, member_id: null })
const events = [
  { slug: 'ev-s', tenant_id: STELLR_TENANT_ID },
  { slug: 'ev-c', tenant_id: CANARY_TENANT_ID },
]

function setup(claimsRole: string | undefined, tables: Tables = {}) {
  db = fakeDb({ members: [{ id: MEMBER, clerk_user_id: USER }], tenants: [{ id: CANARY_TENANT_ID, status: 'active' }], events, ...tables })
  vi.mocked(supabaseServer).mockReturnValue(db.client)
  vi.mocked(auth).mockResolvedValue({ userId: USER, sessionClaims: { metadata: claimsRole ? { role: claimsRole } : {} } } as never)
}

beforeEach(() => {
  resetErrorCaptureState()
  vi.mocked(currentTenantId).mockReturnValue(CANARY_TENANT_ID)
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the clerk source on another tenant\'s host fails closed', () => {
  it.each(['admin', 'event_manager'])('a Clerk %s gets nothing', async (role) => {
    setup(role, { event_manager_assignments: [{ clerk_user_id: USER, event_slug: 'ev-c' }] })
    expect(await authz.hasPortalAccess()).toBe(false)
    expect(await authz.assertPlatformAdmin()).toEqual({ ok: false, status: 403 })
    expect(await authz.isStellrAdmin()).toBe(false)
    expect(await authz.isStellrAdminOrUnknown()).toBe(false)
    expect(await authz.requireEventAccess()).toEqual({ ok: false, status: 403 })
    expect(await authz.requireEventAccess('ev-c')).toEqual({ ok: false, status: 403 })
    expect(await authz.hasScope('events')).toBe(false)
    await expect(authz.page.requireAdmin()).rejects.toThrow('NOT_FOUND')
    await expect(authz.page.requireTenantAdmin()).rejects.toThrow('NOT_FOUND')
    await expect(authz.page.requireEventSection()).rejects.toThrow('NOT_FOUND')
  })
})

describe('a staff scope is Stellr\'s', () => {
  it.each(['clerk', 'postgres'])('%s: no scope holds on another tenant\'s host', async (source) => {
    vi.stubEnv('AUTHZ_SOURCE', source)
    setup('admin', {
      tenant_memberships: [mem('tenant_admin')],
      platform_admins: [{ clerk_user_id: USER }],
      admin_duties: [{ member_id: MEMBER, scopes: ['all'] }],
    })
    expect(await authz.hasScope('events')).toBe(false)
    expect(db.reads).not.toContain('admin_duties')
  })
})

describe('postgres: tenant B\'s admin on tenant B\'s host', () => {
  beforeEach(() => {
    vi.stubEnv('AUTHZ_SOURCE', 'postgres')
    setup(undefined, { tenant_memberships: [mem('tenant_admin', CANARY_TENANT_ID)] })
  })
  it('passes the section guard, with the answer tied to tenant B', async () => {
    expect(await authz.requireEventAccess()).toEqual({ ok: true, userId: USER, isAdmin: true, assignedSlugs: null, tenantId: CANARY_TENANT_ID })
    expect(await authz.hasPortalAccess()).toBe(true)
    await expect(authz.page.requireTenantAdmin()).resolves.toBeUndefined()
  })
  it('does not reach a Stellr row through that section answer', async () => {
    const access = await authz.requireEventAccess()
    expect(await authz.accessCoversEvent(access, 'ev-c')).toBe(true)
    expect(await authz.accessCoversEvent(access, 'ev-s')).toBe(false)
  })
  it('is refused on a Stellr event by slug, and is no Stellr admin', async () => {
    expect(await authz.requireEventAccess('ev-s')).toEqual({ ok: false, status: 403 })
    expect(await authz.isStellrAdmin()).toBe(false)
  })
})

describe('postgres: a Stellr tenant admin on another tenant\'s host', () => {
  it('is no Stellr admin there', async () => {
    vi.stubEnv('AUTHZ_SOURCE', 'postgres')
    setup(undefined, { tenant_memberships: [mem('tenant_admin')] })
    expect(await authz.isStellrAdmin()).toBe(false)
    expect(await authz.isStellrAdminOrUnknown()).toBe(false)
    vi.mocked(currentTenantId).mockReturnValue(STELLR_TENANT_ID)
    expect(await authz.isStellrAdmin()).toBe(true)
  })
})

describe('postgres: a platform admin on another tenant\'s host', () => {
  beforeEach(() => {
    vi.stubEnv('AUTHZ_SOURCE', 'postgres')
    setup(undefined, { platform_admins: [{ clerk_user_id: USER }] })
  })
  it('is still a platform admin, for the console', async () => {
    expect((await authz.assertPlatformAdmin()).ok).toBe(true)
  })
  it('has no access to the tenant\'s staff surface or events without support mode', async () => {
    expect(await authz.hasPortalAccess()).toBe(false)
    expect(await authz.isStellrAdmin()).toBe(false)
    expect(await authz.isStellrAdminOrUnknown()).toBe(false)
    expect((await authz.requireTenantCrew(CANARY_TENANT_ID, ['tenant_admin'])).ok).toBe(false)
    expect(await authz.requireEventAccess()).toEqual({ ok: false, status: 403 })
    expect(await authz.requireEventAccess('ev-c')).toEqual({ ok: false, status: 403 })
  })
})
