import { describe, it, expect, vi, beforeEach } from 'vitest'
import { appToday } from '@/lib/age'

// Deep-review REG-4 regression test for the group-join route: the event lookup
// must fail closed. A still-valid join link must not admit a new participant
// (with a DocuSign envelope, Space grant and payment email) during a Sanity
// outage or when the event has vanished from the CMS.

const h = vi.hoisted(() => ({
  getEventBySlug: vi.fn(async (_slug: string): Promise<unknown> => ({ title: 'Colorado', activityType: 'live_event' })),
  partInsert: vi.fn(),
  auth: vi.fn(async () => ({ userId: null as string | null })),
  // AUTH-N2: controllable rate-limit guard (null = proceed by default).
  rlGuard: vi.fn((_req: unknown, _route: string, _opts: unknown, _suffix?: string): Response | null => null),
  // REG-7: controllable DB errors (null/false = healthy by default).
  dedupeError: null as { code?: string; message?: string } | null,
  countError: null as { message?: string } | null,
  insertError: null as { code?: string; message?: string } | null,
  // S0: the signed-in member's stored profile, and what the route writes.
  signedInMember: null as Record<string, unknown> | null,
  upsertMember: vi.fn(async (_db: unknown, _m: Record<string, unknown>, _o?: unknown) => 'm-1'),
  dispatch: vi.fn(async (_db: unknown, _a: Record<string, unknown>) => {}),
  getUserList: vi.fn(async () => ({ data: [] as Array<{ id: string }> })),
  createUser: vi.fn(async () => ({ id: 'user_new' })),
  createSignInToken: vi.fn(async () => ({ token: 'tkt' })),
  // Decision 24: the signed-in caller is a child whose parent has not consented.
  childAwaiting: false,
}))

const tokenRow = {
  token: 'tok', registration_id: 'reg-1', event_slug: 'colorado', event_title: 'Colorado',
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  registrations: { status: 'pending', withdrawn_at: null, school_name: 'Denver High', adult_count: 1, student_count: 2 },
}

// lib/clerk-provisioning runs for real (the COPPA guard); only Clerk is faked.
vi.mock('@clerk/nextjs/server', () => ({
  auth: h.auth,
  clerkClient: async () => ({
    users: { getUserList: h.getUserList, createUser: h.createUser },
    signInTokens: { createSignInToken: h.createSignInToken },
  }),
}))
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: () => {} }))
vi.mock('@/lib/pending-consent', async (orig) => {
  const real = await orig<typeof import('@/lib/pending-consent')>()
  return { ...real, childAwaitingConsentBlock: async () => (h.childAwaiting ? real.consentPendingResponse() : null) }
})
vi.mock('@/lib/sanity', () => ({ getEventBySlug: h.getEventBySlug }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain, not: () => chain, is: () => chain,
        maybeSingle: async () => {
          if (table === 'group_join_tokens') return { data: tokenRow, error: null }
          if (table === 'members') return { data: h.signedInMember, error: null }
          // participants maybeSingle is the REG-7 dedupe pre-check.
          if (table === 'participants' && h.dedupeError) return { data: null, error: h.dedupeError }
          return { data: null, error: null }
        },
        single: async () =>
          table === 'participants' && h.insertError
            ? { data: null, error: h.insertError }
            : { data: { id: 'p-1' }, error: null },
        insert: (p: unknown) => { if (table === 'participants') h.partInsert(p); return chain },
        upsert: () => chain, update: () => chain,
        then: (onF: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: table === 'participants' ? h.countError : null, count: 0 }).then(onF),
      }
      return chain
    },
  }),
}))
vi.mock('@/lib/email', () => ({ sendEmail: async () => {}, groupMemberJoinedEmail: () => ({ subject: '', html: '', text: '' }) }))
vi.mock('@/lib/individual-payment', () => ({ ensureIndividualPayments: async () => {} }))
vi.mock('@/lib/docusign-agreements', () => ({ dispatchAgreement: h.dispatch }))
vi.mock('@/lib/school-link', () => ({ linkMembersToSchoolByName: async () => {} }))
vi.mock('@/lib/event-participation-sync', () => ({ recordEventParticipation: async () => {} }))
vi.mock('@/lib/space-inheritance', () => ({ syncObjectSpaceRoster: async () => {}, reconcileEventSpaceRoster: async () => {} }))
vi.mock('@/lib/member-sync', () => ({ upsertMember: h.upsertMember }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: h.rlGuard, HOUR_MS: 3_600_000 }))

const { POST } = await import('./route')

function post(details: Record<string, unknown> = {}) {
  return POST(
    new Request('https://www.stellreducation.org/api/register/group-join', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'tok', details: { first_name: 'K', last_name: 'Id', email: 'kid@example.com', date_of_birth: '2012-01-01', ...details } }),
    }) as never,
  )
}

const TODAY = appToday().toISOString().slice(0, 10)
/** A date of birth `n` years before the app's today, less `extraDays`. */
function yearsAgo(n: number, extraDays = 0): string {
  const d = appToday()
  d.setUTCFullYear(d.getUTCFullYear() - n)
  d.setUTCDate(d.getUTCDate() - extraDays)
  return d.toISOString().slice(0, 10)
}

beforeEach(() => {
  vi.clearAllMocks()
  // The event is today, so "age on the event date" and "age today" agree.
  h.getEventBySlug.mockResolvedValue({ title: 'Colorado', activityType: 'live_event', date: TODAY })
  h.auth.mockResolvedValue({ userId: null })
  h.signedInMember = null
  h.getUserList.mockResolvedValue({ data: [] })
  h.rlGuard.mockReturnValue(null)
  h.dedupeError = null
  h.countError = null
  h.insertError = null
  h.childAwaiting = false
})

// Decision 24, COPPA (review finding, 3 Nov 2026): a signed-in child whose
// parent has not consented joins nothing until the parent signs.
describe('POST /api/register/group-join — a child awaiting a parent’s consent', () => {
  it('is refused before anyone is admitted', async () => {
    h.auth.mockResolvedValue({ userId: 'clerk-kid' })
    h.childAwaiting = true
    const res = await post()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('guardian_consent_pending')
    expect(h.partInsert).not.toHaveBeenCalled()
    expect(h.upsertMember).not.toHaveBeenCalled()
  })
})

describe('POST /api/register/group-join', () => {
  it('REG-4: a Sanity outage fails closed with 503 and admits no one', async () => {
    h.getEventBySlug.mockRejectedValue(new Error('sanity timeout'))
    const res = await post()
    expect(res.status).toBe(503)
    expect(h.partInsert).not.toHaveBeenCalled()
  })

  it('REG-4: an unresolved event is treated as closed (403), admitting no one', async () => {
    h.getEventBySlug.mockResolvedValue(null)
    const res = await post()
    expect(res.status).toBe(403)
    expect(h.partInsert).not.toHaveBeenCalled()
  })

  // ── AUTH-N2 ────────────────────────────────────────────────────────────────
  it('AUTH-N2: runs the rate-limit guard first, sub-keyed by the join token', async () => {
    await post()
    expect(h.rlGuard).toHaveBeenCalledWith(
      expect.anything(),
      'register-group-join',
      { limit: 3, windowMs: 3_600_000 },
      'tok',
    )
  })

  it('AUTH-N2: a throttled caller gets 429 and admits no one', async () => {
    h.rlGuard.mockReturnValue(
      new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 }),
    )
    const res = await post()
    expect(res.status).toBe(429)
    expect(h.partInsert).not.toHaveBeenCalled()
  })

  // ── REG-7 ────────────────────────────────────────────────────────────────
  it('REG-7: fails closed (503) and admits no one when the dedupe lookup errors', async () => {
    h.dedupeError = { message: 'transient db error' }
    const res = await post()
    expect(res.status).toBe(503)
    expect(h.partInsert).not.toHaveBeenCalled()
  })

  it('REG-7: fails closed (503) when the capacity count errors', async () => {
    h.countError = { message: 'transient db error' }
    const res = await post()
    expect(res.status).toBe(503)
    expect(h.partInsert).not.toHaveBeenCalled()
  })

  it('REG-7: a unique-violation on insert (lost race) is a 409, not a 500', async () => {
    h.insertError = { code: '23505', message: 'duplicate key value violates unique constraint' }
    const res = await post()
    expect(res.status).toBe(409)
    // The insert was attempted (the index is what caught the race).
    expect(h.partInsert).toHaveBeenCalled()
  })
})

describe('POST /api/register/group-join — S0 age gate', () => {
  it.each([
    ['unknown (missing)', undefined, undefined],
    ['unknown (blank)', '', undefined],
    ['invalid (not a date)', 'abc', 'dob_invalid'],
    ['invalid (no such day)', '2013-02-30', 'dob_invalid'],
    ['invalid (US format)', '06/01/2013', 'dob_invalid'],
    ['invalid (implausible year)', '0201-05-05', 'dob_invalid'],
    ['in the future', '2999-01-01', 'dob_invalid'],
  ])('a new joiner whose date of birth is %s is a 400 before any member, login or participant', async (_l, dob, code) => {
    const res = await post({ date_of_birth: dob, type: 'Mentor' })
    expect(res.status).toBe(400)
    // A blank one is caught with the other required fields, before the age check.
    expect((await res.json()).code).toBe(code)
    expect(h.upsertMember).not.toHaveBeenCalled()
    expect(h.getUserList).not.toHaveBeenCalled()
    expect(h.createUser).not.toHaveBeenCalled()
    expect(h.partInsert).not.toHaveBeenCalled()
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('a 12-year-old joins as a participant, with no login and no sign-in token', async () => {
    const dob = yearsAgo(13, -1) // 13 tomorrow
    const res = await post({ date_of_birth: dob, type: 'Mentor' })
    expect(res.status).toBe(201)
    expect((await res.json()).signInToken).toBeNull()
    expect(h.upsertMember).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ date_of_birth: dob, event_role: 'participant', age_bracket: 'high_school' }), expect.anything())
    expect(h.partInsert).toHaveBeenCalledWith(expect.objectContaining({ date_of_birth: dob, event_role: 'participant' }))
    expect(h.getUserList).not.toHaveBeenCalled()
    expect(h.createUser).not.toHaveBeenCalled()
  })

  it.each([
    ['13', yearsAgo(13)],
    ['14', yearsAgo(14)],
  ])('a %s-year-old joins as a participant and gets the login', async (_l, dob) => {
    const res = await post({ date_of_birth: dob })
    expect(res.status).toBe(201)
    expect((await res.json()).signInToken).toBe('tkt')
    expect(h.createUser).toHaveBeenCalledTimes(1)
    expect(h.partInsert).toHaveBeenCalledWith(expect.objectContaining({ event_role: 'participant' }))
  })

  it('adults are unaffected: the chosen role stands and they get the login', async () => {
    const res = await post({ date_of_birth: '1985-04-01', type: 'Mentor' })
    expect(res.status).toBe(201)
    expect((await res.json()).signInToken).toBe('tkt')
    expect(h.partInsert).toHaveBeenCalledWith(expect.objectContaining({ event_role: 'mentor', age_bracket: 'adult' }))
  })

  it('a signed-in member with no usable date of birth on their profile is asked to fix it, not read as an adult', async () => {
    h.auth.mockResolvedValue({ userId: 'user_me' })
    // Account → Profile has no date-of-birth field: a missing one is added on
    // the profile-completion page, a wrong one only staff can correct.
    for (const [dob, code, says] of [
      [null, 'dob_missing', /add your date of birth at https:\/\/\S+\/account\/onboarding/],
      ['not a date', 'dob_invalid', /doesn't look right\. Please contact Stellr/],
      ['2999-01-01', 'dob_invalid', /doesn't look right\. Please contact Stellr/],
    ] as const) {
      h.signedInMember = { id: 'm-me', first_name: 'M', last_name: 'E', email: 'me@example.com', date_of_birth: dob, age_bracket: 'adult', event_role: 'teacher' }
      const res = await post()
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.code).toBe(code)
      expect(json.error).toMatch(says)
      expect(json.error).not.toMatch(/Account → Profile/)
    }
    expect(h.partInsert).not.toHaveBeenCalled()
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it.each([
    ['12', yearsAgo(13, -1)],
    ['13', yearsAgo(13)],
    ['14', yearsAgo(14)],
  ])('a signed-in %s-year-old whose profile holds an adult role joins as a participant', async (_l, dob) => {
    h.auth.mockResolvedValue({ userId: 'user_me' })
    h.signedInMember = { id: 'm-me', first_name: 'M', last_name: 'E', email: 'me@example.com', date_of_birth: dob, age_bracket: 'adult', event_role: 'mentor' }
    const res = await post()
    expect(res.status).toBe(201)
    expect(h.partInsert).toHaveBeenCalledWith(expect.objectContaining({ date_of_birth: dob, event_role: 'participant', age_bracket: 'high_school' }))
    expect(h.createUser).not.toHaveBeenCalled()
  })

  it('a signed-in minor who is a school student manager stays one', async () => {
    h.auth.mockResolvedValue({ userId: 'user_me' })
    h.signedInMember = { id: 'm-me', first_name: 'M', last_name: 'E', email: 'me@example.com', date_of_birth: yearsAgo(16), age_bracket: 'adult', event_role: 'school_student_manager' }
    expect((await post()).status).toBe(201)
    expect(h.partInsert).toHaveBeenCalledWith(expect.objectContaining({ event_role: 'school_student_manager', age_bracket: 'high_school' }))
  })

  it('a signed-in member with a date of birth on file joins as before', async () => {
    h.auth.mockResolvedValue({ userId: 'user_me' })
    h.signedInMember = { id: 'm-me', first_name: 'M', last_name: 'E', email: 'me@example.com', date_of_birth: '1985-04-01', age_bracket: 'adult', event_role: 'teacher' }
    const res = await post()
    expect(res.status).toBe(201)
    expect(h.partInsert).toHaveBeenCalledWith(expect.objectContaining({ date_of_birth: '1985-04-01', event_role: 'teacher' }))
    expect(h.createUser).not.toHaveBeenCalled()
  })
})
