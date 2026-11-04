import { describe, it, expect, vi, beforeEach } from 'vitest'
import { appToday } from '@/lib/age'

// Deep-review REG-4 regression test for the individual registration route: the
// event lookup must fail closed. A Sanity outage is a retryable 503 and an
// unknown slug is a 404 — neither may fall through to creating a member,
// participant and DocuSign envelope for an unresolved event.
//
// S0 (2 Nov 2026): the date of birth is checked server-side before anything is
// written, and the COPPA guard decides the login. lib/clerk-provisioning runs
// for real; only Clerk is faked, so these see the guard's actual decision.

const h = vi.hoisted(() => ({
  getEventBySlug: vi.fn(async (_slug: string): Promise<unknown> => ({ title: 'Colorado', activityType: 'live_event' })),
  getCurrentMember: vi.fn(async (): Promise<unknown> => null),
  regInsert: vi.fn(),
  partInsert: vi.fn(),
  memberUpsert: vi.fn(),
  dispatch: vi.fn(async (_db: unknown, _a: Record<string, unknown>) => {}),
  getUserList: vi.fn(async () => ({ data: [] as Array<{ id: string }> })),
  createUser: vi.fn(async () => ({ id: 'user_new' })),
  createSignInToken: vi.fn(async () => ({ token: 'tkt' })),
  // AUTH-N2: controllable rate-limit guard (null = proceed by default).
  rlGuard: vi.fn((_req: unknown, _route: string, _opts: unknown, _suffix?: string): Response | null => null),
  // Decision 24: the signed-in caller is a child whose parent has not consented.
  childAwaiting: false,
}))

vi.mock('@/lib/sanity', () => ({ getEventBySlug: h.getEventBySlug }))
vi.mock('@/lib/community', () => ({ getCurrentMember: h.getCurrentMember }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      let op = 'select'
      const result = () => {
        if (op === 'insert' && table === 'registrations') return { data: { id: 'reg-1' }, error: null }
        if (op === 'insert' && table === 'participants') return { data: { id: 'p-1' }, error: null }
        if (op === 'upsert' && table === 'members') return { data: { id: 'm-1' }, error: null }
        return { data: null, error: null }
      }
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain, in: () => chain, is: () => chain,
        maybeSingle: async () => result(), single: async () => result(),
        insert: (p: unknown) => {
          op = 'insert'
          if (table === 'registrations') h.regInsert(p)
          if (table === 'participants') h.partInsert(p)
          return chain
        },
        upsert: (p: unknown) => { op = 'upsert'; if (table === 'members') h.memberUpsert(p); return chain },
        update: () => { op = 'update'; return chain }, delete: () => { op = 'delete'; return chain },
        then: (onF: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(onF),
      }
      return chain
    },
  }),
}))
vi.mock('@clerk/nextjs/server', () => ({
  // Signed out: the decision-24 pending-child check has no one to look up.
  auth: async () => ({ userId: null }),
  clerkClient: async () => ({
    users: { getUserList: h.getUserList, createUser: h.createUser },
    signInTokens: { createSignInToken: h.createSignInToken },
  }),
}))
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: () => {} }))
vi.mock('@/lib/pending-consent', async (orig) => {
  const real = await orig<typeof import('@/lib/pending-consent')>()
  return { ...real, sessionChildAwaitingConsentBlock: async () => (h.childAwaiting ? real.consentPendingResponse() : null) }
})
vi.mock('@/lib/scholarships', () => ({ findOfferByToken: async () => null, attachOfferToRegistration: async () => {} }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => null }))
vi.mock('@/lib/docusign-agreements', () => ({ dispatchAgreement: h.dispatch }))
vi.mock('@/lib/registration-pay-link', () => ({ sendPayLinkEmail: async () => ({ sent: false, recipients: [] }) }))
vi.mock('@/lib/registration-duplicates', () => ({ findExistingRegistrations: async () => new Map(), resolveDuplicate: () => ({ kind: 'none' }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: h.rlGuard, HOUR_MS: 3_600_000 }))
vi.mock('@/lib/school-link', () => ({ resolveAndLinkSchool: async () => ({ state: 'CO' }) }))
vi.mock('@/lib/member-profile-options', () => ({ syncMemberOptionSelections: async () => {} }))
vi.mock('@/lib/event-participation-sync', () => ({ recordEventParticipation: async () => {} }))
vi.mock('@/lib/auto-membership-grant', () => ({ autoGrantBaseMembership: async () => {} }))
vi.mock('@/lib/store/event-merch', () => ({ prepareRegistrationAddons: async () => [], addRegistrationAddons: async () => {} }))
vi.mock('@/lib/registration-confirm', () => ({ confirmRegistration: async () => {} }))
vi.mock('@/lib/registration-checkout', () => ({
  createRegistrationCheckout: async () => ({ url: 'https://checkout.test' }),
  RegistrationCheckoutError: class extends Error {},
  ensurePayToken: async () => 'paytok',
  mintPayToken: () => 'paytok',
  payPageUrl: () => 'https://www.stellreducation.org/pay',
  pendingAddonLines: async () => [],
}))

const { POST } = await import('./route')

const TODAY = appToday().toISOString().slice(0, 10)
/** A date of birth `n` years before the app's today, less `extraDays`. */
function yearsAgo(n: number, extraDays = 0): string {
  const d = appToday()
  d.setUTCFullYear(d.getUTCFullYear() - n)
  d.setUTCDate(d.getUTCDate() - extraDays)
  return d.toISOString().slice(0, 10)
}

function post(overrides: Record<string, unknown> = {}) {
  const b = {
    event_slug: 'colorado', event_title: 'Colorado',
    email: 'kid@example.com', first_name: 'K', last_name: 'Id',
    date_of_birth: '2012-01-01', school_name: 'Denver High',
    ...overrides,
  }
  return POST(
    new Request('https://www.stellreducation.org/api/register/individual', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
    }) as never,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // The event is today, so "age on the event date" and "age today" agree.
  h.getEventBySlug.mockResolvedValue({ title: 'Colorado', activityType: 'live_event', date: TODAY })
  h.getCurrentMember.mockResolvedValue(null)
  h.rlGuard.mockReturnValue(null)
  h.getUserList.mockResolvedValue({ data: [] })
  h.childAwaiting = false
})

describe('POST /api/register/individual', () => {
  it('REG-4: a Sanity outage fails closed with 503 and creates no registration', async () => {
    h.getEventBySlug.mockRejectedValue(new Error('sanity timeout'))
    const res = await post()
    expect(res.status).toBe(503)
    expect(h.regInsert).not.toHaveBeenCalled()
  })

  it('REG-4: an unknown slug fails closed with 404 and creates no registration', async () => {
    h.getEventBySlug.mockResolvedValue(null)
    const res = await post()
    expect(res.status).toBe(404)
    expect(h.regInsert).not.toHaveBeenCalled()
  })

  // ── AUTH-N2 ────────────────────────────────────────────────────────────────
  it('AUTH-N2: runs the rate-limit guard first, sub-keyed by event slug', async () => {
    await post()
    expect(h.rlGuard).toHaveBeenCalledWith(
      expect.anything(),
      'register-individual',
      { limit: 3, windowMs: 3_600_000 },
      'colorado',
    )
  })

  it('AUTH-N2: a throttled caller gets 429 and creates no registration', async () => {
    h.rlGuard.mockReturnValue(
      new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 }),
    )
    const res = await post()
    expect(res.status).toBe(429)
    expect(h.regInsert).not.toHaveBeenCalled()
  })
})

// Decision 24, COPPA (review finding, 3 Nov 2026): a signed-in child whose
// parent has not consented registered for events like anyone else.
describe('POST /api/register/individual — a child awaiting a parent’s consent', () => {
  it('is refused before anything is written', async () => {
    h.childAwaiting = true
    const res = await post()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('guardian_consent_pending')
    expect(h.regInsert).not.toHaveBeenCalled()
    expect(h.memberUpsert).not.toHaveBeenCalled()
  })
})

describe('POST /api/register/individual — S0 age gate', () => {
  it.each([
    ['unknown (missing)', undefined, 'dob_missing'],
    ['unknown (null)', null, 'dob_missing'],
    ['unknown (blank)', '', 'dob_missing'],
    ['invalid (not a date)', 'abc', 'dob_invalid'],
    ['invalid (no such day)', '2013-02-30', 'dob_invalid'],
    ['invalid (US format)', '12/01/2012', 'dob_invalid'],
    ['invalid (implausible year)', '0201-05-05', 'dob_invalid'],
    ['in the future', '2999-01-01', 'dob_invalid'],
  ])('a date of birth that is %s is a 400 before anything is written, whatever role was picked', async (_l, dob, code) => {
    const res = await post({ date_of_birth: dob, event_role: 'mentor', age_bracket: 'adult' })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe(code)
    expect(json.error).toMatch(/date of birth/)
    expect(h.regInsert).not.toHaveBeenCalled()
    expect(h.memberUpsert).not.toHaveBeenCalled()
    expect(h.partInsert).not.toHaveBeenCalled()
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(h.getUserList).not.toHaveBeenCalled()
    expect(h.createUser).not.toHaveBeenCalled()
  })

  it('a 12-year-old is registered as a participant, with no login and no sign-in token', async () => {
    const dob = yearsAgo(13, -1) // 13 tomorrow
    const res = await post({ date_of_birth: dob, event_role: 'mentor', age_bracket: 'adult' })
    expect(res.status).toBe(201)
    expect((await res.json()).signInToken).toBeNull()
    expect(h.memberUpsert).toHaveBeenCalledWith(expect.objectContaining({ date_of_birth: dob, event_role: 'participant', age_bracket: 'high_school' }))
    expect(h.partInsert).toHaveBeenCalledWith(expect.objectContaining({ date_of_birth: dob, event_role: 'participant' }))
    expect(h.dispatch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ dateOfBirth: dob, eventRole: 'participant' }))
    expect(h.getUserList).not.toHaveBeenCalled()
    expect(h.createUser).not.toHaveBeenCalled()
  })

  it.each([
    ['13', yearsAgo(13)],
    ['14', yearsAgo(14)],
  ])('a %s-year-old is a participant and gets the login and sign-in token', async (_l, dob) => {
    const res = await post({ date_of_birth: dob })
    expect(res.status).toBe(201)
    expect((await res.json()).signInToken).toBe('tkt')
    expect(h.memberUpsert).toHaveBeenCalledWith(expect.objectContaining({ event_role: 'participant', age_bracket: 'high_school' }))
    expect(h.createUser).toHaveBeenCalledWith(expect.objectContaining({ emailAddress: ['kid@example.com'] }))
  })

  it('takes the age on the event date, but a minor today is still a participant', async () => {
    // 17 today, 18 at an event a year out: not refused, and not stored as an adult.
    h.getEventBySlug.mockResolvedValue({ title: 'Colorado', activityType: 'live_event', date: yearsAgo(-1) })
    const res = await post({ date_of_birth: yearsAgo(18, -1), event_role: 'mentor', age_bracket: 'college' })
    expect(res.status).toBe(201)
    expect(h.memberUpsert).toHaveBeenCalledWith(expect.objectContaining({ event_role: 'participant', age_bracket: 'high_school' }))
  })

  it('adults are unaffected: their role and bracket stand, and they get the login', async () => {
    const res = await post({ date_of_birth: '1985-04-01', event_role: 'mentor', age_bracket: 'college' })
    expect(res.status).toBe(201)
    expect((await res.json()).signInToken).toBe('tkt')
    expect(h.memberUpsert).toHaveBeenCalledWith(expect.objectContaining({ date_of_birth: '1985-04-01', event_role: 'mentor', age_bracket: 'college' }))
    expect(h.dispatch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventRole: 'mentor' }))
  })
})
