// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Decision 24: memberCommunityTier is the one helper every community write
// route asks. A minor waiting on guardian consent is read-only; an under-13
// with consent may react and join, but not post, comment, chat, upload or
// contribute (no moderated space exists yet).

const { state } = vi.hoisted(() => ({
  state: { pending: new Set<string>(), consentLanded: new Set<string>() },
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: null }) }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({}) }))
vi.mock('@/lib/pending-consent', async (orig) => ({
  ...(await orig<typeof import('./pending-consent')>()),
  getPendingConsent: async (_db: unknown, id: string) => (state.pending.has(id) ? { member_id: id } : null),
  settlePendingConsent: async (_db: unknown, id: string) => state.consentLanded.has(id),
}))

const { memberCommunityTier, communityWriteBlock, tierAllows } = await import('./community')
const { appToday } = await import('@/lib/age')

const yearsAgo = (n: number) => {
  const d = appToday()
  d.setUTCFullYear(d.getUTCFullYear() - n)
  return d.toISOString().slice(0, 10)
}

const WRITES = ['post', 'comment', 'chat', 'react', 'upload', 'contribute', 'join'] as const
const before = process.env.MINOR_SELF_SIGNUP_ENABLED

beforeEach(() => {
  state.pending = new Set()
  state.consentLanded = new Set()
  process.env.MINOR_SELF_SIGNUP_ENABLED = 'true'
})
afterEach(() => { process.env.MINOR_SELF_SIGNUP_ENABLED = before })

describe('memberCommunityTier', () => {
  it('a pending minor of any age is consent_pending', async () => {
    state.pending.add('teen')
    state.pending.add('kid')
    expect(await memberCommunityTier({ id: 'teen', date_of_birth: yearsAgo(15) })).toBe('consent_pending')
    expect(await memberCommunityTier({ id: 'kid', date_of_birth: yearsAgo(12) })).toBe('consent_pending')
  })

  it('leaves the pending state once the guardian agreement is on file', async () => {
    state.pending.add('teen')
    state.consentLanded.add('teen')
    expect(await memberCommunityTier({ id: 'teen', date_of_birth: yearsAgo(15) })).toBe('full')
  })

  it('12 after consent is child; 13, 15, 17 and 18 are full; an unknown date is not presumed a child here', async () => {
    expect(await memberCommunityTier({ id: 'a', date_of_birth: yearsAgo(12) })).toBe('child')
    for (const n of [13, 15, 17, 18]) {
      expect(await memberCommunityTier({ id: 'a', date_of_birth: yearsAgo(n) }), String(n)).toBe('full')
    }
    expect(await memberCommunityTier({ id: 'a', date_of_birth: null })).toBe('full')
  })

  it('with the flag off, an under-13 keeps today’s access; a pending row still restricts', async () => {
    process.env.MINOR_SELF_SIGNUP_ENABLED = 'false'
    expect(await memberCommunityTier({ id: 'a', date_of_birth: yearsAgo(12) })).toBe('full')
    state.pending.add('p')
    expect(await memberCommunityTier({ id: 'p', date_of_birth: yearsAgo(15) })).toBe('consent_pending')
  })

  it('a platform admin is never restricted', async () => {
    state.pending.add('adm')
    expect(await memberCommunityTier({ id: 'adm', date_of_birth: yearsAgo(12), isAdmin: true })).toBe('full')
  })
})

describe('tierAllows / communityWriteBlock', () => {
  it('full allows every write; consent_pending none; child only react and join', () => {
    for (const w of WRITES) {
      expect(tierAllows('full', w)).toBe(true)
      expect(tierAllows('consent_pending', w)).toBe(false)
      expect(tierAllows('child', w), w).toBe(w === 'react' || w === 'join')
    }
  })

  it('returns a 403 with the reason code, or null', async () => {
    state.pending.add('teen')
    const res = await communityWriteBlock({ id: 'teen', date_of_birth: yearsAgo(15) }, 'post')
    expect(res?.status).toBe(403)
    expect((await res!.json()).code).toBe('guardian_consent_pending')

    const kid = await communityWriteBlock({ id: 'kid', date_of_birth: yearsAgo(12) }, 'chat')
    expect(kid?.status).toBe(403)
    expect((await kid!.json()).code).toBe('community_restricted')

    expect(await communityWriteBlock({ id: 'kid', date_of_birth: yearsAgo(12) }, 'react')).toBeNull()
    expect(await communityWriteBlock({ id: 'adult', date_of_birth: yearsAgo(30) }, 'post')).toBeNull()
  })
})
