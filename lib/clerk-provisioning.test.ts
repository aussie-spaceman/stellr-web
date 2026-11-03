import { describe, it, expect, vi, beforeEach } from 'vitest'

// Regression tests for deep review C-1 (findings REG-1 + AUTH-2): the public,
// unauthenticated registration routes must only receive a silent sign-in token
// when THIS request created both the Clerk user and the member row. An existing
// Clerk account, or a brand-new Clerk user bound to an existing member row, must
// never yield a usable session for an anonymous caller.
//
// And the COPPA guard (S0, 2 Nov 2026): a child under 13, or anyone whose age
// is unknown, gets no Clerk login until a parent or guardian's agreement is on
// file — and the refusal comes before Clerk is even asked about the address.

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

import { ensureClerkUserAndSignInToken, guardedEnsureClerkUser } from './clerk-provisioning'
import { appToday } from './age'

/** A date of birth `years` years before the app's today (Mountain time), less `extraDays`. */
function bornYearsAgo(years: number, extraDays = 0): string {
  const d = appToday()
  d.setUTCFullYear(d.getUTCFullYear() - years)
  d.setUTCDate(d.getUTCDate() - extraDays)
  return d.toISOString().slice(0, 10)
}

const ADULT = { dateOfBirth: '1985-04-01' }

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
    const r = await ensureClerkUserAndSignInToken('new@x.test', 'New', 'Person', { memberIsNew: true, age: ADULT })
    expect(r.created).toBe(true)
    expect(r.signInToken).toBe('tkt_minted')
    expect(createSignInToken).toHaveBeenCalledOnce()
  })

  it('refuses a token for an existing member even if the email has a Clerk account (takeover of the owner)', async () => {
    getUserList.mockResolvedValue({ data: [{ id: 'user_victim' }] }) // existing account
    const r = await ensureClerkUserAndSignInToken('admin@stellr.test', 'A', 'D', { memberIsNew: false, age: ADULT })
    expect(r.created).toBe(false)
    // AUTH-N3: an existing member short-circuits before any Clerk lookup, so we
    // never mint a token AND never hand the caller the owner's Clerk id to link.
    expect(r.clerkUserId).toBe('')
    expect(r.signInToken).toBeNull()
    expect(createSignInToken).not.toHaveBeenCalled()
  })

  it('provisions NO Clerk user at all when the member row already exists (AUTH-N3)', async () => {
    // The dangerous case AUTH-2 flags: email on file as a member (a student a
    // teacher added) but with no Clerk login yet. deep review AUTH-N3: we must
    // not even CREATE a Clerk user here — doing so let the user.created webhook
    // bind a passwordless Clerk user to the victim's member row (an
    // attacker-triggered clerk_user_id write) and could send Clerk mail to a
    // real person. So: no createUser, no token, created=false.
    getUserList.mockResolvedValue({ data: [] })
    const r = await ensureClerkUserAndSignInToken('kid@family.test', 'Kid', 'One', { memberIsNew: false, age: ADULT })
    expect(createUser).not.toHaveBeenCalled()
    expect(r.created).toBe(false)
    expect(r.signInToken).toBeNull()
    expect(createSignInToken).not.toHaveBeenCalled()
  })

  it('refuses a token for an existing Clerk account even when the member row is new', async () => {
    getUserList.mockResolvedValue({ data: [{ id: 'user_other' }] })
    const r = await ensureClerkUserAndSignInToken('has-clerk@x.test', 'H', 'C', { memberIsNew: true, age: ADULT })
    expect(r.signInToken).toBeNull()
    expect(createSignInToken).not.toHaveBeenCalled()
  })
})

describe('ensureClerkUserAndSignInToken — the COPPA guard on registration', () => {
  it.each([
    ['12', bornYearsAgo(12)],
    ['one day short of 13', bornYearsAgo(13, -1)],
    ['unknown', null],
    ['not given', undefined],
    ['blank', ''],
    ['unreadable', '12/01/2013'],
    ['impossible', '2013-02-29'],
    ['in the future', '2999-01-01'],
  ])('a new registrant aged %s gets no login, no token, and Clerk is never asked', async (_label, dob) => {
    getUserList.mockResolvedValue({ data: [] })
    const r = await ensureClerkUserAndSignInToken('kid@x.test', 'K', 'Id', { memberIsNew: true, age: { dateOfBirth: dob } })
    expect(r).toEqual({ clerkUserId: '', signInToken: null, created: false })
    expect(getUserList).not.toHaveBeenCalled()
    expect(createUser).not.toHaveBeenCalled()
    expect(createSignInToken).not.toHaveBeenCalled()
  })

  it.each([
    ['13 today', bornYearsAgo(13)],
    ['14', bornYearsAgo(14)],
    ['an adult', '1985-04-01'],
  ])('a new registrant who is %s gets the login and the token as before', async (_label, dob) => {
    getUserList.mockResolvedValue({ data: [] })
    const r = await ensureClerkUserAndSignInToken('teen@x.test', 'T', 'Een', { memberIsNew: true, age: { dateOfBirth: dob } })
    expect(createUser).toHaveBeenCalledOnce()
    expect(r.signInToken).toBe('tkt_minted')
  })
})

describe('guardedEnsureClerkUser', () => {
  it('lets an under-13 through once a guardian agreement is on file', async () => {
    getUserList.mockResolvedValue({ data: [] })
    const r = await guardedEnsureClerkUser('kid@x.test', 'K', 'Id', {
      dateOfBirth: bornYearsAgo(12),
      guardianAgreementOnFile: async () => true,
    })
    expect(r).toEqual({ allowed: true, clerkUserId: 'user_new', created: true, basis: 'guardian_agreement' })
  })

  it('refuses an under-13 when the agreement lookup says no, or throws', async () => {
    const no = await guardedEnsureClerkUser('kid@x.test', 'K', 'Id', {
      dateOfBirth: bornYearsAgo(12),
      guardianAgreementOnFile: async () => false,
    })
    expect(no).toEqual({ allowed: false, reason: 'under_13' })
    const broken = await guardedEnsureClerkUser('kid@x.test', 'K', 'Id', {
      dateOfBirth: null,
      guardianAgreementOnFile: async () => { throw new Error('db down') },
    })
    expect(broken).toEqual({ allowed: false, reason: 'age_unknown' })
    expect(getUserList).not.toHaveBeenCalled()
  })

  it('does not look for a guardian agreement for someone 13 or over', async () => {
    getUserList.mockResolvedValue({ data: [] })
    const onFile = vi.fn(async () => false)
    expect(await guardedEnsureClerkUser('a@x.test', 'A', 'B', { dateOfBirth: bornYearsAgo(13), guardianAgreementOnFile: onFile }))
      .toMatchObject({ allowed: true, basis: 'dob' })
    expect(onFile).not.toHaveBeenCalled()
  })

  it('lets an unknown age through on an admin adult record, but never overrides a DOB under 13', async () => {
    getUserList.mockResolvedValue({ data: [] })
    const unknown = await guardedEnsureClerkUser('t@x.test', 'T', 'Each', { dateOfBirth: null, adultByRole: true })
    expect(unknown).toMatchObject({ allowed: true, basis: 'adult_by_role' })

    createUser.mockClear()
    const child = await guardedEnsureClerkUser('k@x.test', 'K', 'Id', { dateOfBirth: bornYearsAgo(11), adultByRole: true })
    expect(child).toEqual({ allowed: false, reason: 'under_13' })
    expect(createUser).not.toHaveBeenCalled()
  })

  it('reports a DOB of 13 or over as the basis, and a Clerk failure still throws', async () => {
    getUserList.mockResolvedValue({ data: [{ id: 'user_old' }] })
    expect(await guardedEnsureClerkUser('a@x.test', 'A', 'B', { dateOfBirth: bornYearsAgo(14) }))
      .toEqual({ allowed: true, clerkUserId: 'user_old', created: false, basis: 'dob' })
    getUserList.mockRejectedValue(new Error('clerk 500'))
    await expect(guardedEnsureClerkUser('a@x.test', 'A', 'B', { dateOfBirth: bornYearsAgo(14) })).rejects.toThrow('clerk 500')
  })
})
