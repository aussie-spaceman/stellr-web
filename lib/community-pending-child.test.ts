// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// Decision 24, COPPA (review finding, 3 Nov 2026): a child under 13 whose
// parent has not consented must be inactive at the API layer too. Only page
// redirects held them back, so GET /api/community/posts and /chat served them
// other members' posts and messages, and the routes outside the write helper
// (coaching request, mentoring register, Space invite accept) took their
// writes. getCurrentMember, which all of those resolve through, now resolves
// no member for them.
const { state } = vi.hoisted(() => ({
  state: { db: null as FakeDb | null, viewAs: null as string | null, admin: false },
}))

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: 'clerk-kid', sessionClaims: state.admin ? { metadata: { role: 'admin' } } : {} }),
}))
vi.mock('@/lib/admin-auth', () => ({ isAdminClaims: () => state.admin }))
vi.mock('@/lib/impersonation', () => ({ impersonatedMemberId: async () => state.viewAs }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => state.db!.client }))

const { getCurrentMember } = await import('./community')
const { appToday } = await import('@/lib/age')

const yearsAgo = (n: number) => {
  const d = appToday()
  d.setUTCFullYear(d.getUTCFullYear() - n)
  return d.toISOString().slice(0, 10)
}

function seed(dob: string | null, pending: 'child' | 'teen' | null, opts: { failPending?: boolean; consented?: boolean } = {}) {
  state.db = fakeSupabase(
    {
      members: [{ id: 'kid', clerk_user_id: 'clerk-kid', first_name: 'Sam', date_of_birth: dob, gender: null }],
      member_pending_consent: pending
        ? [{ member_id: 'kid', band: pending, guardian_email: 'parent@example.test', consented_at: null }]
        : [],
      participants: [],
      agreements: opts.consented
        ? [{ id: 'a1', member_id: 'kid', participant_id: null, envelope_type: 'minor', status: 'completed' }]
        : [],
    },
    { failOn: (table) => (opts.failPending && table === 'member_pending_consent' ? 'timeout' : null) },
  )
}

beforeEach(() => {
  state.viewAs = null
  state.admin = false
})

describe('getCurrentMember — a child awaiting a parent’s consent', () => {
  it('resolves no member, so every member API refuses them, reads included', async () => {
    seed(yearsAgo(12), 'child')
    expect(await getCurrentMember()).toBeNull()
  })

  it('fails closed when the pending-consent read fails for an under-13', async () => {
    seed(yearsAgo(12), null, { failPending: true })
    expect(await getCurrentMember()).toBeNull()
  })

  it('resolves them once the parent has signed', async () => {
    seed(yearsAgo(12), 'child', { consented: true })
    expect((await getCurrentMember())?.id).toBe('kid')
  })

  it('a pending teen still resolves (read-only is enforced on writes), and an adult never pays for the read', async () => {
    seed(yearsAgo(15), 'teen')
    expect((await getCurrentMember())?.id).toBe('kid')
    seed(yearsAgo(30), null, { failPending: true })
    expect((await getCurrentMember())?.id).toBe('kid')
  })

  it('an admin viewing as the child still sees their account', async () => {
    seed(yearsAgo(12), 'child')
    state.admin = true
    state.viewAs = 'kid'
    expect((await getCurrentMember())?.id).toBe('kid')
  })
})
