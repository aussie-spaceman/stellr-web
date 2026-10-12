import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review AUTH-4: membership_id is a zero-padded sequential counter, so a
// lookup that resolved it to a name on the id ALONE was a walkable directory of
// members' (minors' included) names. The route now requires the caller to also
// supply the person's last name and only confirms when it matches. These tests
// pin that the name is withheld unless a correct surname is supplied.

const { state } = vi.hoisted(() => ({
  state: {
    members: {} as Record<string, { first_name: string; last_name: string }>,
    participants: {} as Record<string, { first_name: string; last_name: string; member_id: string | null }>,
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
          const byMembership = filters.find(([k]) => k === 'membership_id')?.[1] as string | undefined
          if (table === 'members' && byMembership) return { data: state.members[byMembership] ?? null, error: null }
          if (table === 'participants' && byMembership) return { data: state.participants[byMembership] ?? null, error: null }
          return { data: null, error: null }
        },
      }
      return chain
    },
  }),
}))

const { GET } = await import('./route')

let ipCounter = 0
function get(qs: string) {
  // Unique IP per call so the shared in-memory limiter never 429s across tests.
  return GET(
    new Request(`https://app.stellreducation.org/api/members/lookup?${qs}`, {
      headers: { 'x-forwarded-for': `10.0.0.${ipCounter++}` },
    }),
  )
}

beforeEach(() => {
  state.members = { '0000018': { first_name: 'Ada', last_name: 'Lovelace' } }
  state.participants = {}
})

describe('GET /api/members/lookup', () => {
  it('withholds the name when no last name is supplied (AUTH-4)', async () => {
    const res = await get('membership_id=18')
    const body = await res.json()
    expect(body).toEqual({ found: false })
    expect(body.first_name).toBeUndefined()
  })

  it('withholds the name when the supplied surname is wrong (AUTH-4)', async () => {
    const res = await get('membership_id=18&last_name=Babbage')
    expect(await res.json()).toEqual({ found: false })
  })

  it('confirms and returns the name when the surname matches (case-insensitive)', async () => {
    const res = await get('membership_id=18&last_name=lovelace')
    expect(await res.json()).toEqual({ found: true, first_name: 'Ada', last_name: 'Lovelace' })
  })

  it('resolves the legacy participant id only with the correct surname', async () => {
    state.members = {}
    state.participants = { '0000042': { first_name: 'Grace', last_name: 'Hopper', member_id: null } }
    expect(await (await get('membership_id=42&last_name=Hopper')).json()).toEqual({
      found: true, first_name: 'Grace', last_name: 'Hopper',
    })
    expect(await (await get('membership_id=42&last_name=Turing')).json()).toEqual({ found: false })
  })
})
