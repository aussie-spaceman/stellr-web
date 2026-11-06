// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// Which member a request resolves to, through both modules that export it. Member
// pages and API routes act as the member getCurrentMember names, and admin surfaces
// record the acting admin from getSignedInMember, so the two must not cross.
const { state } = vi.hoisted(() => ({
  state: {
    db: null as FakeDb | null,
    userId: 'clerk-admin' as string | null,
    admin: true,
    viewAs: null as string | null,
    authCalls: 0,
    caches: [] as Map<unknown, unknown>[],
  },
}))

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => {
    state.authCalls++
    return { userId: state.userId, sessionClaims: {} }
  },
}))
vi.mock('@/lib/admin-auth', () => ({ isAdminClaims: () => state.admin }))
vi.mock('@/lib/impersonation', () => ({ impersonatedMemberId: async () => state.viewAs }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => state.db!.client }))

// React's cache() only memoizes in a server render. This one memoizes here, so the
// test can see one lookup per render, keyed on the argument as React's is.
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  cache: <A, R>(fn: (arg: A) => R) => {
    const seen = new Map<unknown, unknown>()
    state.caches.push(seen)
    return (arg: A) => {
      if (!seen.has(arg)) seen.set(arg, fn(arg))
      return seen.get(arg) as R
    }
  },
}))

const session = await import('./member-session')
const community = await import('./community')

const ADULT = { date_of_birth: '1980-01-01', gender: 'female' }
const FUTURE = '2999-01-01'
const PAST = '2001-01-01'

const tier = (name: string, is_free: boolean) => ({ name, is_free })

function seed(rows: Record<string, unknown>[]) {
  state.db = fakeSupabase({ members: rows })
}

beforeEach(() => {
  state.userId = 'clerk-admin'
  state.admin = true
  state.viewAs = null
  state.authCalls = 0
  for (const seen of state.caches) seen.clear()
})

describe.each([
  ['lib/member-session', session],
  ['lib/community', community],
])('%s', (_name, mod) => {
  const admin = { id: 'admin-1', clerk_user_id: 'clerk-admin', first_name: 'Ada', ...ADULT, member_memberships: [] }
  const viewed = { id: 'member-1', clerk_user_id: 'clerk-member', first_name: 'Max', date_of_birth: null, gender: null, member_memberships: [] }

  it('an admin viewing as a member: getCurrentMember is that member, without the admin bypass', async () => {
    seed([admin, viewed])
    state.viewAs = 'member-1'
    const member = await mod.getCurrentMember()
    expect(member).toMatchObject({ id: 'member-1', isAdmin: false })
  })

  it('an admin viewing as a member: getSignedInMember is still the admin', async () => {
    seed([admin, viewed])
    state.viewAs = 'member-1'
    const member = await mod.getSignedInMember()
    expect(member).toMatchObject({ id: 'admin-1', isAdmin: true })
  })

  it('never sends a viewing admin to onboarding, since they cannot complete it for the member', async () => {
    seed([admin, viewed])
    state.viewAs = 'member-1'
    expect((await mod.getCurrentMember())?.needsOnboarding).toBe(false)
  })

  it('a view-as id with no admin claim changes nothing', async () => {
    seed([{ ...admin, id: 'plain-1' }, viewed])
    state.admin = false
    state.viewAs = 'member-1'
    expect(await mod.getCurrentMember()).toMatchObject({ id: 'plain-1', isAdmin: false })
  })

  it('counts only memberships active and not past their expiry', async () => {
    seed([{
      ...admin,
      member_memberships: [
        { renewal_status: 'active', started_at: '2024-01-01', expires_at: null, tier_id: 'free', membership_tiers: tier('Free', true) },
        { renewal_status: 'active', started_at: '2025-01-01', expires_at: FUTURE, tier_id: 'paid', membership_tiers: [tier('Pathfinder', false)] },
        { renewal_status: 'active', started_at: '2026-01-01', expires_at: PAST, tier_id: 'lapsed', membership_tiers: tier('Lapsed', false) },
        { renewal_status: 'cancelled', started_at: '2026-02-01', expires_at: null, tier_id: 'gone', membership_tiers: tier('Gone', false) },
      ],
    }])
    expect(await mod.getCurrentMember()).toMatchObject({
      activeTierIds: ['paid', 'free'],
      activeTierName: 'Pathfinder',
      hasPaidTier: true,
    })
  })

  it('a free tier alone is not a paid tier', async () => {
    seed([{
      ...admin,
      member_memberships: [{ renewal_status: 'active', started_at: '2024-01-01', expires_at: null, tier_id: 'free', membership_tiers: tier('Free', true) }],
    }])
    expect(await mod.getCurrentMember()).toMatchObject({ hasPaidTier: false, activeTierName: 'Free' })
  })

  it.each([
    ['date of birth', { date_of_birth: null, gender: 'female' }, true],
    ['gender', { date_of_birth: '1980-01-01', gender: null }, true],
    ['nothing', ADULT, false],
  ])('needsOnboarding, missing %s', async (_missing, fields, expected) => {
    seed([{ ...admin, ...fields }])
    expect((await mod.getCurrentMember())?.needsOnboarding).toBe(expected)
  })

  it('resolves no member when signed out, or with no row', async () => {
    seed([])
    expect(await mod.getCurrentMember()).toBeNull()
    expect(await mod.getSignedInMember()).toBeNull()
    state.userId = null
    for (const seen of state.caches) seen.clear()
    expect(await mod.getCurrentMember()).toBeNull()
  })
})

describe('one lookup per render', () => {
  const row = { id: 'admin-1', clerk_user_id: 'clerk-admin', ...ADULT, member_memberships: [] }

  it('shares a lookup between the two modules, and asks once however many callers', async () => {
    seed([row])
    await session.getCurrentMember()
    await community.getCurrentMember()
    await session.getCurrentMember()
    expect(state.authCalls).toBe(1)
  })

  it('keeps the viewed member and the signed-in member apart', async () => {
    seed([row, { id: 'member-1', clerk_user_id: 'clerk-member', ...ADULT, member_memberships: [] }])
    state.viewAs = 'member-1'
    const [current, signedIn] = await Promise.all([community.getCurrentMember(), community.getSignedInMember()])
    expect(current?.id).toBe('member-1')
    expect(signedIn?.id).toBe('admin-1')
    expect(state.authCalls).toBe(2)
  })
})
