import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// deep review AUTH-4: /api/members/exists was a world-readable account-existence
// oracle (confirm whether any email belongs to a member). It now requires a live
// group-join invite token before answering. These tests pin that the members
// table is never even consulted without a valid, unexpired token, and that the
// token path still answers correctly for a legitimate caller.

const { state } = vi.hoisted(() => ({
  state: {
    tokens: {} as Record<string, { expires_at: string }>,
    members: {} as Record<string, { id: string; clerk_user_id: string | null }>,
    membersQueried: false,
  },
}))

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const filters: [string, unknown][] = []
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return chain },
        maybeSingle: async () => {
          if (table === 'group_join_tokens') {
            const tok = filters.find(([k]) => k === 'token')?.[1] as string | undefined
            return { data: (tok && state.tokens[tok]) ?? null, error: null }
          }
          if (table === 'members') {
            state.membersQueried = true
            const email = filters.find(([k]) => k === 'email')?.[1] as string | undefined
            return { data: (email && state.members[email]) ?? null, error: null }
          }
          return { data: null, error: null }
        },
      }
      return chain
    },
  }),
}))

const { GET } = await import('./route')

const future = () => new Date(Date.now() + 60_000).toISOString()
const past = () => new Date(Date.now() - 60_000).toISOString()

let ipCounter = 0
function get(qs: string) {
  return GET(
    new NextRequest(`https://app.stellreducation.org/api/members/exists?${qs}`, {
      headers: { 'x-forwarded-for': `10.1.0.${ipCounter++}` },
    }),
  )
}

beforeEach(() => {
  state.tokens = { goodtok: { expires_at: future() }, oldtok: { expires_at: past() } }
  state.members = { 'kid@example.com': { id: 'm1', clerk_user_id: 'user_1' } }
  state.membersQueried = false
})

describe('GET /api/members/exists', () => {
  it('does not answer (or query members) without a token (AUTH-4)', async () => {
    const res = await get('email=kid@example.com')
    expect(await res.json()).toEqual({ hasAccount: false })
    expect(state.membersQueried).toBe(false)
  })

  it('does not answer for an unknown token (AUTH-4)', async () => {
    const res = await get('email=kid@example.com&token=nope')
    expect(await res.json()).toEqual({ hasAccount: false })
    expect(state.membersQueried).toBe(false)
  })

  it('does not answer for an expired token (AUTH-4)', async () => {
    const res = await get('email=kid@example.com&token=oldtok')
    expect(await res.json()).toEqual({ hasAccount: false })
    expect(state.membersQueried).toBe(false)
  })

  it('answers hasAccount:true with a live token and an email that has a login', async () => {
    const res = await get('email=kid@example.com&token=goodtok')
    expect(await res.json()).toEqual({ hasAccount: true })
    expect(state.membersQueried).toBe(true)
  })

  it('answers hasAccount:false with a live token for an email with no account', async () => {
    const res = await get('email=stranger@example.com&token=goodtok')
    expect(await res.json()).toEqual({ hasAccount: false })
  })
})
