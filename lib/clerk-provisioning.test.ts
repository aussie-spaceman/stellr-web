import { describe, it, expect, vi, beforeEach } from 'vitest'

// Regression tests for deep review C-1 (findings REG-1 + AUTH-2): the public,
// unauthenticated registration routes must only receive a silent sign-in token
// when THIS request created both the Clerk user and the member row. An existing
// Clerk account, or a brand-new Clerk user bound to an existing member row, must
// never yield a usable session for an anonymous caller.

const getUserList = vi.fn()
const createUser = vi.fn()
const createSignInToken = vi.fn()
const assertLiveCredentials = vi.fn()

vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: async () => ({
    users: { getUserList, createUser },
    signInTokens: { createSignInToken },
  }),
}))
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: (...a: unknown[]) => assertLiveCredentials(...a) }))

import { ensureClerkUserAndSignInToken } from './clerk-provisioning'

beforeEach(() => {
  getUserList.mockReset()
  createUser.mockReset()
  createSignInToken.mockReset()
  assertLiveCredentials.mockReset()
  createSignInToken.mockResolvedValue({ token: 'tkt_minted' })
  createUser.mockResolvedValue({ id: 'user_new' })
})

describe('ensureClerkUserAndSignInToken — who may be silently signed in', () => {
  it('mints a token only when BOTH the Clerk user and the member row are new', async () => {
    getUserList.mockResolvedValue({ data: [] }) // no existing Clerk user → createUser runs
    const r = await ensureClerkUserAndSignInToken('new@x.test', 'New', 'Person', { memberIsNew: true })
    expect(r.created).toBe(true)
    expect(r.signInToken).toBe('tkt_minted')
    expect(createSignInToken).toHaveBeenCalledOnce()
  })

  it('refuses a token when the email already has a Clerk account (takeover of the owner)', async () => {
    getUserList.mockResolvedValue({ data: [{ id: 'user_victim' }] }) // existing account
    const r = await ensureClerkUserAndSignInToken('admin@stellr.test', 'A', 'D', { memberIsNew: false })
    expect(r.created).toBe(false)
    expect(r.clerkUserId).toBe('user_victim')
    expect(r.signInToken).toBeNull()
    expect(createSignInToken).not.toHaveBeenCalled()
  })

  it('refuses a token when a NEW Clerk user would be bound to an EXISTING member row', async () => {
    // The dangerous case AUTH-2 flags: email on file as a member (a student a
    // teacher added) but with no Clerk login yet. A fresh Clerk user is created,
    // but the member is not new, so no token — and the caller must not link.
    getUserList.mockResolvedValue({ data: [] })
    const r = await ensureClerkUserAndSignInToken('kid@family.test', 'Kid', 'One', { memberIsNew: false })
    expect(r.created).toBe(true)
    expect(r.signInToken).toBeNull()
    expect(createSignInToken).not.toHaveBeenCalled()
  })

  it('refuses a token for an existing Clerk account even when the member row is new', async () => {
    getUserList.mockResolvedValue({ data: [{ id: 'user_other' }] })
    const r = await ensureClerkUserAndSignInToken('has-clerk@x.test', 'H', 'C', { memberIsNew: true })
    expect(r.signInToken).toBeNull()
    expect(createSignInToken).not.toHaveBeenCalled()
  })
})
