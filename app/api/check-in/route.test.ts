import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review REG-8: a name + date-of-birth check-in lookup must not be a
// presence oracle. Whatever the reason a name+DOB doesn't resolve to exactly one
// participant (unusable DOB, duplicate, or simply not on the roster), the route
// returns the SAME response, so holding only the shared event token tells you
// nothing about whether a specific child is registered. The real credential —
// the email you registered with — still checks people in.

const h = vi.hoisted(() => ({
  settings: { check_in_token: 'tok', check_in_open: true } as Record<string, unknown> | null,
  regs: [] as unknown[],
}))

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        neq: () => chain,
        is: () => chain,
        update: () => chain,
        maybeSingle: async () => ({ data: table === 'event_settings' ? h.settings : null, error: null }),
        then: (onF: (v: unknown) => unknown) =>
          Promise.resolve({ data: table === 'registrations' ? h.regs : null, error: null }).then(onF),
      }
      return chain
    },
  }),
}))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: async () => ({ setting: 'in_person' }) }))
vi.mock('@/lib/rate-limit', () => ({
  rateLimitGuard: () => null,
  checkRateLimit: () => ({ ok: true, retryAfterSeconds: 0 }),
  HOUR_MS: 3_600_000,
}))
vi.mock('@/lib/check-in-view', () => ({ loadCheckInView: async () => ({ firstName: 'x', lastName: 'y' }) }))

const { POST } = await import('./route')

function post(fields: Record<string, unknown>) {
  return POST(
    new Request('https://www.stellreducation.org/api/check-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'colorado', token: 'tok', ...fields }),
    }),
  )
}

const participant = (over: Record<string, unknown> = {}) => ({
  id: 'p1', first_name: 'Alex', last_name: 'Smith', nickname: null,
  date_of_birth: '2011-04-09', email: 'parent@example.com', checked_in_at: null, ...over,
})

async function bodyAndStatus(fields: Record<string, unknown>) {
  const res = await post(fields)
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  h.settings = { check_in_token: 'tok', check_in_open: true }
  h.regs = []
})

describe('POST /api/check-in — REG-8 presence oracle', () => {
  it('returns the same response for an on-roster name (unusable DOB) and a name not on the roster', async () => {
    // On the roster, but the stored DOB is unusable → used to leak "need_email".
    h.regs = [{ id: 'r1', participants: [participant({ date_of_birth: null })] }]
    const onRoster = await bodyAndStatus({ firstName: 'Alex', lastName: 'Smith', dob: '2011-04-09' })

    // Not on the roster at all → used to be a distinct "none".
    h.regs = [{ id: 'r1', participants: [participant({ first_name: 'Someone', last_name: 'Else' })] }]
    const notOnRoster = await bodyAndStatus({ firstName: 'Nobody', lastName: 'Here', dob: '2011-04-09' })

    expect(onRoster).toEqual(notOnRoster)
    expect(onRoster.status).toBe(404)
    expect(onRoster.body.code).toBe('need_email')
  })

  it('returns that same response for an ambiguous (duplicate) name+DOB', async () => {
    h.regs = [{ id: 'r1', participants: [participant({ id: 'a' }), participant({ id: 'b' })] }]
    const ambiguous = await bodyAndStatus({ firstName: 'Alex', lastName: 'Smith', dob: '2011-04-09' })

    h.regs = [{ id: 'r1', participants: [participant({ first_name: 'Someone', last_name: 'Else' })] }]
    const notOnRoster = await bodyAndStatus({ firstName: 'Nobody', lastName: 'Here', dob: '2011-04-09' })

    expect(ambiguous).toEqual(notOnRoster)
  })
})

// deep review TEST-8: the check-in JOURNEY (a name+DOB lookup on minors at the
// door) had no route-level test — only lib/check-in's matcher was covered. These
// pin the door flow itself: a correct lookup checks the participant in, a wrong
// DOB is the generic miss, and a wrong token never reaches the roster at all.
describe('POST /api/check-in — the door journey', () => {
  it('checks in the participant on a correct name + DOB', async () => {
    h.regs = [{ id: 'r1', participants: [participant()] }]
    const res = await post({ firstName: 'Alex', lastName: 'Smith', dob: '2011-04-09' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.alreadyCheckedIn).toBe(false)
    expect(body.view).toBeTruthy()
  })

  it('does NOT check in on a correct name but wrong DOB (generic miss)', async () => {
    h.regs = [{ id: 'r1', participants: [participant()] }]
    const { status, body } = await bodyAndStatus({ firstName: 'Alex', lastName: 'Smith', dob: '2000-01-01' })
    expect(status).toBe(404)
    expect(body.code).toBe('need_email')
  })

  it('refuses a request whose token is not the event token, before reading the roster', async () => {
    h.regs = [{ id: 'r1', participants: [participant()] }]
    const res = await POST(
      new Request('https://www.stellreducation.org/api/check-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: 'colorado', token: 'WRONG', firstName: 'Alex', lastName: 'Smith', dob: '2011-04-09' }),
      }),
    )
    expect(res.status).toBe(403)
  })
})
