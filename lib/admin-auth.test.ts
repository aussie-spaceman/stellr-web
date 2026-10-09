import { afterEach, describe, it, expect, vi } from 'vitest'

// The claim shape every /api/admin route used to re-implement inline:
// Clerk publicMetadata.role === 'admin'. These pin the helper so the 37
// routes that now share it cannot drift.
const authMock = vi.fn()
// deep review TEST-2: currentUserHasScope was untested, so the staff_roles
// fallback (a non-admin member holding a granted scope) had no coverage. A
// table-keyed fake drives the members → staff_roles lookup it performs.
const dbState: { member: { id: string } | null; scopes: string[] | null } = { member: null, scopes: null }
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock() }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) chain[m] = () => chain
      chain.maybeSingle = async () =>
        table === 'members'
          ? { data: dbState.member, error: null }
          : { data: dbState.scopes == null ? null : { scopes: dbState.scopes }, error: null }
      return chain
    },
  }),
}))

import { isAdminClaims, isEventManagerClaims, hasAdminPortalAccess, currentUserIsAdmin, currentUserHasScope } from './admin-auth'

afterEach(() => {
  authMock.mockReset()
  dbState.member = null
  dbState.scopes = null
})

describe('isAdminClaims', () => {
  it('is true only for metadata.role === "admin"', () => {
    expect(isAdminClaims({ metadata: { role: 'admin' } })).toBe(true)
    expect(isAdminClaims({ metadata: { role: 'event_manager' } })).toBe(false)
    expect(isAdminClaims({ metadata: { role: 'Admin' } })).toBe(false)
    expect(isAdminClaims({ metadata: {} })).toBe(false)
    expect(isAdminClaims({})).toBe(false)
    expect(isAdminClaims(null)).toBe(false)
    expect(isAdminClaims(undefined)).toBe(false)
  })

  it('event managers get the portal shell but are not admins', () => {
    const claims = { metadata: { role: 'event_manager' } }
    expect(isEventManagerClaims(claims)).toBe(true)
    expect(hasAdminPortalAccess(claims)).toBe(true)
    expect(isAdminClaims(claims)).toBe(false)
  })
})

describe('currentUserIsAdmin', () => {
  it('reads the session and applies the same rule', async () => {
    authMock.mockResolvedValueOnce({ userId: 'u1', sessionClaims: { metadata: { role: 'admin' } } })
    expect(await currentUserIsAdmin()).toBe(true)
    authMock.mockResolvedValueOnce({ userId: 'u2', sessionClaims: { metadata: { role: 'member' } } })
    expect(await currentUserIsAdmin()).toBe(false)
    authMock.mockResolvedValueOnce({ userId: null, sessionClaims: null })
    expect(await currentUserIsAdmin()).toBe(false)
  })
})

describe('currentUserHasScope', () => {
  it('refuses when there is no session', async () => {
    authMock.mockResolvedValue({ userId: null, sessionClaims: null })
    expect(await currentUserHasScope('events')).toBe(false)
  })

  it('grants every scope to a platform admin without reading staff_roles', async () => {
    authMock.mockResolvedValue({ userId: 'u-admin', sessionClaims: { metadata: { role: 'admin' } } })
    expect(await currentUserHasScope('graduations')).toBe(true)
  })

  it('refuses a signed-in non-admin with no member row', async () => {
    authMock.mockResolvedValue({ userId: 'u-x', sessionClaims: { metadata: { role: 'member' } } })
    dbState.member = null
    expect(await currentUserHasScope('events')).toBe(false)
  })

  it('refuses a member whose staff_roles row lacks the scope', async () => {
    authMock.mockResolvedValue({ userId: 'u-staff', sessionClaims: { metadata: { role: 'member' } } })
    dbState.member = { id: 'm-1' }
    dbState.scopes = ['community']
    expect(await currentUserHasScope('events')).toBe(false)
  })

  it('grants a member holding the exact scope, or the "all" scope', async () => {
    authMock.mockResolvedValue({ userId: 'u-staff', sessionClaims: { metadata: { role: 'member' } } })
    dbState.member = { id: 'm-1' }
    dbState.scopes = ['events']
    expect(await currentUserHasScope('events')).toBe(true)
    dbState.scopes = ['all']
    expect(await currentUserHasScope('graduations')).toBe(true)
  })

  it('refuses a member with no staff_roles row at all', async () => {
    authMock.mockResolvedValue({ userId: 'u-staff', sessionClaims: { metadata: { role: 'member' } } })
    dbState.member = { id: 'm-1' }
    dbState.scopes = null
    expect(await currentUserHasScope('events')).toBe(false)
  })
})
