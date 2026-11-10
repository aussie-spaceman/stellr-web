import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// deep review AUTH-4: /api/members/exists was a world-readable account-existence
// oracle (confirm whether any email belongs to a member). It now requires a live
// group-join invite token before answering. These tests pin that the members
// table is never even consulted without a valid, unexpired token, and that the
// token path still answers correctly for a legitimate caller.

const { state } = vi.hoisted(() => ({
  state: {
    tokens: {} as Record<string, {
      expires_at: string
      tenant_id?: string | null
      registrations?: { tenant_id: string | null } | null
    }>,
    members: {} as Record<string, { id: string; clerk_user_id: string | null }>,
    membersQueried: false,
    reads: [] as string[],
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
          state.reads.push(table)
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
  state.tokens = {
    // NULL tenant: a Stellr row the backfill has not reached.
    goodtok: { expires_at: future(), tenant_id: null, registrations: { tenant_id: null } },
    stellrtok: { expires_at: future(), tenant_id: STELLR, registrations: { tenant_id: STELLR } },
    oldtok: { expires_at: past() },
    tenanttok: { expires_at: future(), tenant_id: CANARY, registrations: { tenant_id: CANARY } },
    // Link and registration disagree: not Stellr's either.
    mixedtok: { expires_at: future(), tenant_id: null, registrations: { tenant_id: CANARY } },
  }
  state.members = { 'kid@example.com': { id: 'm1', clerk_user_id: 'user_1' } }
  state.membersQueried = false
  state.reads = []
})

const STELLR = '00000000-0000-4000-8000-000000000001'
const CANARY = 'c0000000-0000-4000-8000-0000000000aa'

/** Everything an outsider sees of a response: status, headers and body. */
async function seen(res: Response) {
  return { status: res.status, headers: [...res.headers.entries()], body: await res.text() }
}

describe('GET /api/members/exists, a link that is not Stellr’s (S5 A7)', () => {
  it('answers as if no account exists, the same as an unknown link, and never looks at members', async () => {
    const unknown = await seen(await get('email=kid@example.com&token=nope'))
    const unknownReads = [...state.reads]
    for (const tok of ['tenanttok', 'mixedtok']) {
      for (const email of ['kid@example.com', 'stranger@example.com']) {
        state.reads = []
        expect(await seen(await get(`email=${email}&token=${tok}`))).toEqual(unknown)
        // The same reads as an unknown link, so nothing in timing depends on the address.
        expect(state.reads).toEqual(unknownReads)
      }
    }
    expect(JSON.parse(unknown.body)).toEqual({ hasAccount: false })
    expect(state.membersQueried).toBe(false)
  })

  it('Stellr’s own link, stamped or not yet backfilled, still answers', async () => {
    for (const tok of ['goodtok', 'stellrtok']) {
      expect(await (await get(`email=kid@example.com&token=${tok}`)).json()).toEqual({ hasAccount: true })
    }
  })
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
