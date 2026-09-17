import { describe, it, expect, vi } from 'vitest'

// The claim shape every /api/admin route used to re-implement inline:
// Clerk publicMetadata.role === 'admin'. These pin the helper so the 37
// routes that now share it cannot drift.
const authMock = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock() }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({}) }))

import { isAdminClaims, isEventManagerClaims, hasAdminPortalAccess, currentUserIsAdmin } from './admin-auth'

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
