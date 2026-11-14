/**
 * staff-role.8: lib/authz.ts resolves Staff capabilities only on a session with
 * a second factor. It does not reconcile the grant from here (see lib/authz.ts):
 * the tests pin that, so wiring it in is a visible change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeDb, MEMBER } from '@/test/fixtures/authz-principal'

const getUser = vi.fn(async (_id: string) => ({ twoFactorEnabled: true }))
const nudgeStaff = vi.fn(async (..._a: unknown[]) => {})

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn(), clerkClient: async () => ({ users: { getUser } }) }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: vi.fn() }))
vi.mock('@/lib/staff', () => ({ nudgeStaff: (...a: unknown[]) => nudgeStaff(...a) }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`) }),
  notFound: vi.fn(() => { throw new Error('NOT_FOUND') }),
}))

import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { STAFF_CAPABILITIES } from '@/lib/authz/capabilities'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import * as authz from '@/lib/authz'

let n = 0
/** A fresh user per test: the check keeps a per-user cache for a minute. */
function signIn(role: string, factorVerificationAge: unknown): string {
  const userId = `user_mfa_${++n}`
  const db = fakeDb({ members: [{ id: MEMBER, clerk_user_id: userId }] })
  vi.mocked(supabaseServer).mockReturnValue(db.client)
  vi.mocked(auth).mockResolvedValue({ userId, sessionClaims: { metadata: { role } }, factorVerificationAge } as never)
  return userId
}

beforeEach(() => {
  getUser.mockClear()
  getUser.mockImplementation(async () => ({ twoFactorEnabled: true }))
  nudgeStaff.mockClear()
  vi.stubEnv('AUTHZ_SOURCE', 'clerk')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('requireCapability: Staff and the second factor', () => {
  it('MFA on the session: Staff holds its capabilities, with no Clerk read and no reconcile', async () => {
    signIn('staff', [5, 5])
    expect(await authz.requireCapability('members:write')).toEqual({ ok: true, via: 'staff' })
    expect(await authz.hasCapability('portal:read')).toBe(true)
    expect(getUser).not.toHaveBeenCalled()
    expect(nudgeStaff).not.toHaveBeenCalled()
  })

  it('no second factor on the session: no Staff capability, and no write from the request path', async () => {
    signIn('staff', [5, -1])
    expect(await authz.requireCapability('members:write')).toEqual({ ok: false, status: 403 })
    expect(await authz.hasCapability('portal:read')).toBe(false)
    expect(getUser).not.toHaveBeenCalled()
    expect(nudgeStaff).not.toHaveBeenCalled()
  })

  it('no session field: falls back to the account setting, reused within the minute', async () => {
    signIn('staff', null)
    expect(await authz.requireCapability('competitions:write')).toEqual({ ok: true, via: 'staff' })
    expect(await authz.requireCapability('export')).toEqual({ ok: true, via: 'staff' })
    expect(getUser).toHaveBeenCalledTimes(1)
  })

  it('no session field and MFA off on the account: denied', async () => {
    getUser.mockImplementation(async () => ({ twoFactorEnabled: false }))
    signIn('staff', null)
    expect(await authz.requireCapability('competitions:write')).toEqual({ ok: false, status: 403 })
    expect(getUser).toHaveBeenCalledTimes(1)
  })

  it('Clerk unreadable: denied, and nobody is paused for it', async () => {
    getUser.mockImplementation(async () => { throw new Error('clerk down') })
    signIn('staff', null)
    expect(await authz.requireCapability('portal:read')).toEqual({ ok: false, status: 403 })
    expect(nudgeStaff).not.toHaveBeenCalled()
  })

  it('an admin is never gated, whatever the session says', async () => {
    signIn('admin', [5, -1])
    expect(await authz.requireCapability('roles:manage')).toEqual({ ok: true, via: 'admin' })
    expect(getUser).not.toHaveBeenCalled()
    expect(nudgeStaff).not.toHaveBeenCalled()
  })

  it('postgres source: the same gate applies to a Staff membership', async () => {
    vi.stubEnv('AUTHZ_SOURCE', 'postgres')
    const userId = `user_mfa_pg_${++n}`
    const db = fakeDb({
      members: [{ id: MEMBER, clerk_user_id: userId }],
      tenant_memberships: [{ tenant_id: STELLR_TENANT_ID, role: 'staff', clerk_user_id: userId, member_id: null }],
    })
    vi.mocked(supabaseServer).mockReturnValue(db.client)
    vi.mocked(auth).mockResolvedValue({ userId, sessionClaims: { metadata: {} }, factorVerificationAge: [1, -1] } as never)
    expect(await authz.requireCapability('members:write')).toEqual({ ok: false, status: 403 })
    vi.mocked(auth).mockResolvedValue({ userId, sessionClaims: { metadata: {} }, factorVerificationAge: [1, 1] } as never)
    expect(await authz.requireCapability('members:write')).toEqual({ ok: true, via: 'staff' })
  })
})

describe('currentCapabilities: Staff and the second factor', () => {
  it('lists Staff’s set with a second factor, and nothing without one', async () => {
    signIn('staff', [5, 5])
    expect((await authz.currentCapabilities()).sort()).toEqual([...STAFF_CAPABILITIES].sort())
    signIn('staff', [5, -1])
    expect(await authz.currentCapabilities()).toEqual([])
  })
  it('an admin keeps everything', async () => {
    signIn('admin', [5, -1])
    expect((await authz.currentCapabilities()).length).toBeGreaterThan(STAFF_CAPABILITIES.length)
  })
})
