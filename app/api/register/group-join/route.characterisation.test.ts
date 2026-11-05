import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AUTH_APP_URL } from '@/lib/env'
import {
  rec, AGE_CASES, OPEN_EVENT, CLOSED_EVENT, EVENT_UNDER_WAY, EVENT_A_YEAR_OUT,
  DOB_18_TODAY, DOB_18_TOMORROW, DOB_13_TOMORROW, DOB_INVALID_SELF,
  VIEW_AS_REFUSED, viewAsRefusal, eqFilter, jsonRequest, settle,
  type DbCall, type DbResult,
} from '@/test/registration/fixtures'

// S5 A1: characterisation of POST /api/register/group-join as it stands on
// 4 Nov 2026, for both the signed-in member and the brand-new participant. The
// S5 handler split (A5) must keep every expectation here unchanged: status,
// `code`, body, and the order of writes and side effects. If one of these
// fails, the refactor changed behaviour; fix the refactor, not this file. A test
// named KNOWN DEFECT is the exception: it records what happens, and is not a
// contract to preserve.
//
// What is real: the route, lib/registration-eligibility, lib/registration (the
// window), lib/clerk-provisioning (the COPPA login guard; only Clerk is faked)
// and lib/member-enums. Everything with an outside effect is faked and logs
// itself into `rec`.

const h = vi.hoisted(() => ({
  getEventBySlug: vi.fn(async (_slug: string): Promise<unknown> => null),
  auth: vi.fn(async () => ({ userId: null as string | null })),
  impersonation: vi.fn(async (): Promise<Response | null> => null),
  dispatch: vi.fn(async (_db: unknown, _a: Record<string, unknown>) => {}),
  upsertMember: vi.fn(async (_db: unknown, _m: Record<string, unknown>, _o?: unknown): Promise<string | null> => 'm-1'),
  getUserList: vi.fn(async () => ({ data: [] as Array<{ id: string }> })),
  createUser: vi.fn(async () => ({ id: 'user_new' })),
  createSignInToken: vi.fn(async () => ({ token: 'tkt' })),
}))

vi.mock('@/lib/supabase', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return { supabaseServer: () => rec.client() }
})
vi.mock('@/lib/field-crypto-shadow', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return {
    shadowSyncFields: (table: string, ids: ReadonlyArray<string | null | undefined>) =>
      rec.event(`shadow ${table} [${ids.join(',')}]`),
  }
})
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
  return { ...real, childAwaitingConsentBlock: async () => null }
})
vi.mock('@/lib/sanity', () => ({ getEventBySlug: h.getEventBySlug }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: h.impersonation }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: () => null, HOUR_MS: 3_600_000 }))
vi.mock('@/lib/member-sync', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return {
    upsertMember: async (db: unknown, m: Record<string, unknown>, o?: unknown) => {
      rec.event('hook upsertMember')
      return h.upsertMember(db, m, o)
    },
  }
})
vi.mock('@/lib/email', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return {
    sendEmail: async () => { rec.event('hook sendEmail') },
    groupMemberJoinedEmail: () => ({ subject: '', html: '', text: '' }),
  }
})
vi.mock('@/lib/individual-payment', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return { ensureIndividualPayments: async () => { rec.event('hook ensureIndividualPayments') } }
})
vi.mock('@/lib/docusign-agreements', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return {
    dispatchAgreement: async (db: unknown, a: Record<string, unknown>) => {
      rec.event('hook dispatchAgreement')
      await h.dispatch(db, a)
    },
  }
})
vi.mock('@/lib/school-link', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return { linkMembersToSchoolByName: async () => { rec.event('hook linkMembersToSchoolByName') } }
})
vi.mock('@/lib/event-participation-sync', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return { recordEventParticipation: async () => { rec.event('hook recordEventParticipation') } }
})
vi.mock('@/lib/space-inheritance', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return {
    syncObjectSpaceRoster: async () => { rec.event('hook syncObjectSpaceRoster') },
    reconcileEventSpaceRoster: async () => { rec.event('hook reconcileEventSpaceRoster') },
  }
})

const { POST } = await import('./route')

type Row = Record<string, unknown>

const REG = {
  status: 'pending', withdrawn_at: null, school_name: 'Denver High',
  adult_count: 1, student_count: 2, member_pays_individually: false,
  teacher_email: 'teacher@example.com', teacher_first_name: 'T',
}
let tokenRow: Row
let signedInMember: Row | null

function token(overrides: Row = {}, reg: Row = {}): Row {
  return {
    token: 'tok', registration_id: 'reg-1', event_slug: 'colorado', event_title: 'Colorado',
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    registrations: { ...REG, ...reg },
    ...overrides,
  }
}

function member(overrides: Row = {}): Row {
  return {
    id: 'm-signed', first_name: 'Mem', last_name: 'Ber', nickname: null,
    email: 'member@example.com', school_email: null, phone: '555',
    date_of_birth: '1985-04-01', gender: 'female', grade: null, tshirt_size: 'M',
    age_bracket: 'college', event_role: 'mentor',
    ec_first_name: null, ec_last_name: null, ec_email: null, ec_phone: null, ec_relationship: null,
    ...overrides,
  }
}

function post(details?: Row) {
  return POST(jsonRequest('/api/register/group-join', {
    token: 'tok',
    ...(details === undefined ? {} : { details }),
  }))
}

const newcomer = (overrides: Row = {}): Row => ({
  first_name: 'K', last_name: 'Id', email: 'kid@example.com', date_of_birth: '1985-04-01',
  type: 'mentor', phone: '555',
  emergency_contact_first_name: 'P', emergency_contact_email: 'parent@example.com',
  ...overrides,
})

/** Writes and side effects of a successful join, in order. */
function joinWrites(opts: { newcomer: boolean; withLogin: boolean }) {
  return [
    ...(opts.newcomer ? ['hook upsertMember'] : []),
    ...(opts.withLogin ? ['update members'] : []),
    'insert participants',
    'shadow participants [p-1]',
    'hook linkMembersToSchoolByName',
    'hook recordEventParticipation',
    'hook syncObjectSpaceRoster',
    'hook reconcileEventSpaceRoster',
    'hook dispatchAgreement',
    'hook sendEmail',
    'hook ensureIndividualPayments',
  ]
}

function baseResponder(c: DbCall): DbResult | undefined {
  if (c.table === 'group_join_tokens' && c.op === 'select') return { data: tokenRow, error: null }
  const byClerk = c.filters.some((f) => f[0] === 'eq' && f[1] === 'clerk_user_id')
  if (c.table === 'members' && c.op === 'select' && byClerk) return { data: signedInMember, error: null }
  return undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  rec.reset()
  tokenRow = token()
  signedInMember = null
  rec.respond(baseResponder)
  h.getEventBySlug.mockResolvedValue(OPEN_EVENT)
  h.auth.mockResolvedValue({ userId: null })
  h.impersonation.mockResolvedValue(null)
  h.upsertMember.mockResolvedValue('m-1')
  h.getUserList.mockResolvedValue({ data: [] })
})

describe('characterisation: POST /api/register/group-join — view-as', () => {
  it('an admin viewing as a member is refused before the session or the link is read', async () => {
    h.impersonation.mockResolvedValue(viewAsRefusal())
    expect(await settle(await post(newcomer()))).toEqual(VIEW_AS_REFUSED)
    expect(rec.log).toEqual([])
    expect(h.auth).not.toHaveBeenCalled()
    expect(h.getEventBySlug).not.toHaveBeenCalled()
    expect(h.upsertMember).not.toHaveBeenCalled()
  })
})

// The rule that makes an anonymous join link safe (deep review C-1, C-3): naming
// a member already on file gets no session and writes no clerk_user_id. Their
// row is protected by upsertMember's onExisting: 'skip', pinned below.
describe('characterisation: POST /api/register/group-join — a member already on file', () => {
  const OLD_ADDRESS = 'old@school.example.com'

  it.each([
    ['their email', 'email', 'kid@example.com', {}],
    ['their school email', 'school_email', 'kid@example.com', {}],
    ['the school address submitted beside a new email', 'email', OLD_ADDRESS, { school_email: OLD_ADDRESS }],
  ])('found by %s: linked, no login, and no clerk_user_id written', async (_l, column, value, extra) => {
    rec.respond((c) =>
      c.table === 'members' && c.op === 'select' && eqFilter(c, column, value)
        ? { data: { id: 'm-prior' }, error: null }
        : baseResponder(c),
    )
    h.upsertMember.mockResolvedValue('m-prior')
    expect(await settle(await post(newcomer(extra)))).toEqual({
      status: 201,
      body: { success: true, eventSlug: 'colorado', eventTitle: 'Colorado', signInToken: null },
    })
    expect(rec.writes()).toEqual(joinWrites({ newcomer: true, withLogin: false }))
    expect(rec.payloads('update', 'members')).toEqual([])
    expect(h.upsertMember).toHaveBeenCalledWith(expect.anything(), expect.anything(), { onExisting: 'skip' })
    expect(h.getUserList).not.toHaveBeenCalled()
    expect(h.createUser).not.toHaveBeenCalled()
    expect(h.createSignInToken).not.toHaveBeenCalled()
    const [row] = rec.payloads('insert', 'participants') as Row[]
    expect(row.member_id).toBe('m-prior')
  })

  it('a submitted school address adds a third lookup, before the member is written', async () => {
    await post(newcomer({ school_email: OLD_ADDRESS }))
    expect(rec.log.slice(0, 5)).toEqual([
      'select group_join_tokens',
      'select members', // by email
      'select members', // by school_email
      'select members', // the submitted school address, as someone's email
      'hook upsertMember',
    ])
  })

  it('a new member whose email already has a Clerk login gets no token and no link', async () => {
    h.getUserList.mockResolvedValue({ data: [{ id: 'user_existing' }] })
    expect(await settle(await post(newcomer()))).toEqual({
      status: 201,
      body: { success: true, eventSlug: 'colorado', eventTitle: 'Colorado', signInToken: null },
    })
    expect(rec.writes()).toEqual(joinWrites({ newcomer: true, withLogin: false }))
    expect(h.createUser).not.toHaveBeenCalled()
    expect(h.createSignInToken).not.toHaveBeenCalled()
  })

  // The route comment says "a lookup error leaves this false, so no token is
  // minted". It does not: the error fields are discarded, so a failed read is
  // "not found", and a caller whose email has no Clerk login gets a ticket plus
  // a clerk_user_id write onto whatever row upsertMember resolved.
  it('KNOWN DEFECT, fails open: a failed prior-member lookup reads as new, and mints a login', async () => {
    rec.respond((c) =>
      c.table === 'members' && c.op === 'select' ? { data: null, error: { message: 'boom' } } : baseResponder(c),
    )
    h.upsertMember.mockResolvedValue('m-prior')
    expect(await settle(await post(newcomer()))).toEqual({
      status: 201,
      body: { success: true, eventSlug: 'colorado', eventTitle: 'Colorado', signInToken: 'tkt' },
    })
    expect(rec.writes()).toEqual(joinWrites({ newcomer: true, withLogin: true }))
    expect(rec.calls.find((c) => c.op === 'update' && c.table === 'members')?.filters).toEqual([['eq', 'id', 'm-prior']])
  })
})

describe('characterisation: POST /api/register/group-join — which date age is taken on', () => {
  it('a newcomer under 18 on the first day of an event under way is a minor, though an adult today', async () => {
    h.getEventBySlug.mockResolvedValue(EVENT_UNDER_WAY)
    expect((await post(newcomer({ date_of_birth: DOB_18_TODAY }))).status).toBe(201)
    const [row] = rec.payloads('insert', 'participants') as Row[]
    expect(row).toMatchObject({ event_role: 'participant', age_bracket: 'high_school' })
  })

  it('a newcomer under 18 today is a minor, though an adult by the event', async () => {
    h.getEventBySlug.mockResolvedValue(EVENT_A_YEAR_OUT)
    expect((await post(newcomer({ date_of_birth: DOB_18_TOMORROW }))).status).toBe(201)
    const [row] = rec.payloads('insert', 'participants') as Row[]
    expect(row).toMatchObject({ event_role: 'participant', age_bracket: 'high_school' })
  })

  it('the login guard goes on today, not the event: under 13 now gets no login, though 13 by the event', async () => {
    h.getEventBySlug.mockResolvedValue(EVENT_A_YEAR_OUT)
    const { body } = await settle(await post(newcomer({ date_of_birth: DOB_13_TOMORROW })))
    expect(body).toMatchObject({ signInToken: null })
    expect(h.createUser).not.toHaveBeenCalled()
  })

  it('a signed-in member under 18 on the first day of an event under way is a minor, though an adult today', async () => {
    h.auth.mockResolvedValue({ userId: 'clerk-1' })
    signedInMember = member({ date_of_birth: DOB_18_TODAY })
    h.getEventBySlug.mockResolvedValue(EVENT_UNDER_WAY)
    expect((await post()).status).toBe(201)
    const [row] = rec.payloads('insert', 'participants') as Row[]
    expect(row).toMatchObject({ event_role: 'participant', age_bracket: 'high_school' })
  })

  it('a signed-in member under 18 today is a minor, though an adult by the event', async () => {
    h.auth.mockResolvedValue({ userId: 'clerk-1' })
    signedInMember = member({ date_of_birth: DOB_18_TOMORROW })
    h.getEventBySlug.mockResolvedValue(EVENT_A_YEAR_OUT)
    expect((await post()).status).toBe(201)
    const [row] = rec.payloads('insert', 'participants') as Row[]
    expect(row).toMatchObject({ event_role: 'participant', age_bracket: 'high_school' })
  })
})

describe('characterisation: POST /api/register/group-join — link and event gate', () => {
  it('no token is a 400 before any read', async () => {
    const res = await POST(jsonRequest('/api/register/group-join', {}))
    expect(await settle(res)).toEqual({ status: 400, body: { error: 'Token required' } })
    expect(rec.log).toEqual([])
  })

  it('an unknown token is a 404', async () => {
    tokenRow = null as unknown as Row
    expect(await settle(await post(newcomer()))).toEqual({
      status: 404, body: { error: 'Invalid or expired registration link' },
    })
    expect(rec.log).toEqual(['select group_join_tokens'])
  })

  it('an expired token is a 410', async () => {
    tokenRow = token({ expires_at: '2020-01-01T00:00:00Z' })
    expect(await settle(await post(newcomer()))).toEqual({
      status: 410, body: { error: 'This registration link has expired' },
    })
  })

  it('a withdrawn registration is a 410, before the event is looked up', async () => {
    tokenRow = token({}, { status: 'withdrawn' })
    expect(await settle(await post(newcomer()))).toEqual({
      status: 410,
      body: { error: 'This group registration has been withdrawn and is no longer accepting participants.' },
    })
    expect(h.getEventBySlug).not.toHaveBeenCalled()
  })

  it('a Sanity outage is a 503 with nothing written', async () => {
    h.getEventBySlug.mockRejectedValue(new Error('sanity timeout'))
    expect(await settle(await post(newcomer()))).toEqual({
      status: 503,
      body: { error: 'Registration is temporarily unavailable. Please try again shortly.' },
    })
    expect(rec.log).toEqual(['select group_join_tokens'])
  })

  it('an unknown event slug is a 403 "closed" (not a 404) with nothing written', async () => {
    h.getEventBySlug.mockResolvedValue(null)
    expect(await settle(await post(newcomer()))).toEqual({
      status: 403, body: { error: 'Registration for this event is closed.' },
    })
    expect(rec.log).toEqual(['select group_join_tokens'])
  })

  it('a closed window is a 403 with nothing written', async () => {
    h.getEventBySlug.mockResolvedValue(CLOSED_EVENT)
    expect(await settle(await post(newcomer()))).toEqual({
      status: 403, body: { error: 'Registration for this event is closed.' },
    })
    expect(rec.log).toEqual(['select group_join_tokens'])
  })

  it('the window is checked before the date of birth', async () => {
    h.getEventBySlug.mockResolvedValue(CLOSED_EVENT)
    expect((await post(newcomer({ date_of_birth: 'abc' }))).status).toBe(403)
  })
})

describe('characterisation: POST /api/register/group-join — a brand-new participant', () => {
  it('no details is a 400', async () => {
    expect(await settle(await post())).toEqual({
      status: 400, body: { error: 'Please complete your details to join.' },
    })
  })

  it.each([
    ['missing', undefined],
    ['blank', ''],
    ['whitespace', '   '],
  ])('a %s date of birth is the required-fields 400, with NO code, and nothing written', async (_l, dob) => {
    expect(await settle(await post(newcomer({ date_of_birth: dob })))).toEqual({
      status: 400,
      body: { error: 'First name, last name, email and date of birth are required.' },
    })
    expect(rec.writes()).toEqual([])
  })

  it.each([
    ['not a date', 'abc'],
    ['no such day', '2013-02-30'],
    ['in the future', '2999-01-01'],
  ])('a %s date of birth is a 400 dob_invalid, and nothing is written', async (_l, dob) => {
    expect(await settle(await post(newcomer({ date_of_birth: dob })))).toEqual({
      status: 400, body: { code: 'dob_invalid', error: DOB_INVALID_SELF },
    })
    expect(rec.writes()).toEqual([])
    expect(h.upsertMember).not.toHaveBeenCalled()
  })

  it.each(AGE_CASES)('age $age joins with today’s role, bracket, login and write order', async (c) => {
    const res = await settle(await post(newcomer({ date_of_birth: c.dob })))
    expect(res).toEqual({
      status: 201,
      body: { success: true, eventSlug: 'colorado', eventTitle: 'Colorado', signInToken: c.under13 ? null : 'tkt' },
    })
    expect(rec.writes()).toEqual(joinWrites({ newcomer: true, withLogin: !c.under13 }))
    const role = c.minor ? 'participant' : 'mentor'
    const bracket = c.minor ? 'high_school' : 'adult'
    expect(h.upsertMember).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: 'kid@example.com', date_of_birth: c.dob, event_role: role, age_bracket: bracket }),
      { onExisting: 'skip' },
    )
    const [row] = rec.payloads('insert', 'participants') as Row[]
    expect(row).toMatchObject({ member_id: 'm-1', date_of_birth: c.dob, event_role: role, age_bracket: bracket })
    expect(h.dispatch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ participantId: 'p-1', memberId: 'm-1', dateOfBirth: c.dob, eventRole: role }),
    )
  })

  it('a minor school student manager keeps that role', async () => {
    await post(newcomer({ date_of_birth: AGE_CASES[2].dob, type: 'school_student_manager' }))
    const [row] = rec.payloads('insert', 'participants') as Row[]
    expect(row).toMatchObject({ event_role: 'school_student_manager', age_bracket: 'high_school' })
  })

  it('reads and writes in this order', async () => {
    expect((await post(newcomer())).status).toBe(201)
    expect(rec.log).toEqual([
      'select group_join_tokens',
      'select members', // prior member by email
      'select members', // prior member by school_email
      'hook upsertMember',
      'update members',
      'select participants', // already in this group?
      'select participants', // capacity count
      'insert participants',
      'shadow participants [p-1]',
      'hook linkMembersToSchoolByName',
      'hook recordEventParticipation',
      'hook syncObjectSpaceRoster',
      'hook reconcileEventSpaceRoster',
      'hook dispatchAgreement',
      'select participants', // joined count, for the organiser's email
      'hook sendEmail',
      'hook ensureIndividualPayments',
    ])
  })

  it('the participant row, field for field', async () => {
    await post(newcomer())
    expect(rec.payloads('insert', 'participants')).toEqual([{
      registration_id: 'reg-1',
      member_id: 'm-1',
      first_name: 'K',
      last_name: 'Id',
      nickname: null,
      email: 'kid@example.com',
      school_email: null,
      phone: '555',
      date_of_birth: '1985-04-01',
      grade: null,
      gender: null,
      ethnicity: [],
      t_shirt_size: '',
      school_name: 'Denver High',
      age_bracket: 'adult',
      event_role: 'mentor',
      dietary_requirements: [],
      health_conditions: null,
      emergency_contact_first_name: 'P',
      emergency_contact_last_name: null,
      emergency_contact_email: 'parent@example.com',
      emergency_contact_phone: null,
      emergency_contact_relationship: null,
      individual_payment_status: null,
      join_completed_at: expect.any(String),
    }])
  })

  it('member_pays_individually stamps the seat pending', async () => {
    tokenRow = token({}, { member_pays_individually: true })
    await post(newcomer())
    const [row] = rec.payloads('insert', 'participants') as Row[]
    expect(row.individual_payment_status).toBe('pending')
  })

  it('a failed member upsert is a 500 before any participant is written', async () => {
    h.upsertMember.mockResolvedValue(null)
    expect(await settle(await post(newcomer()))).toEqual({
      status: 500, body: { error: 'Failed to create your member account. Please try again.' },
    })
    expect(rec.writes()).toEqual(['hook upsertMember'])
  })
})

describe('characterisation: POST /api/register/group-join — a signed-in member', () => {
  beforeEach(() => {
    h.auth.mockResolvedValue({ userId: 'clerk-1' })
  })

  it('no active member profile is a 404', async () => {
    expect(await settle(await post())).toEqual({
      status: 404,
      body: { error: 'Member profile not found. Please complete your Stellr profile first.' },
    })
    expect(rec.writes()).toEqual([])
  })

  it.each([
    ['missing', null],
    ['blank', ''],
  ])('a %s profile date of birth is a 400 dob_missing pointing at onboarding', async (_l, dob) => {
    signedInMember = member({ date_of_birth: dob })
    expect(await settle(await post())).toEqual({
      status: 400,
      body: { code: 'dob_missing', error: `Please add your date of birth at ${AUTH_APP_URL}/account/onboarding, then open this link again.` },
    })
    expect(rec.writes()).toEqual([])
  })

  it.each([
    ['not a date', 'abc'],
    ['in the future', '2999-01-01'],
  ])('a %s profile date of birth is a 400 dob_invalid', async (_l, dob) => {
    signedInMember = member({ date_of_birth: dob })
    expect(await settle(await post())).toEqual({
      status: 400,
      body: {
        code: 'dob_invalid',
        error: "The date of birth on your Stellr profile doesn't look right. Please contact Stellr to correct it, or ask your group organiser to add you.",
      },
    })
    expect(rec.writes()).toEqual([])
  })

  it('submitted details are ignored: the profile is authoritative', async () => {
    signedInMember = member()
    await post(newcomer({ date_of_birth: 'abc', email: 'other@example.com' }))
    const [row] = rec.payloads('insert', 'participants') as Row[]
    expect(row).toMatchObject({ email: 'member@example.com', member_id: 'm-signed', date_of_birth: '1985-04-01' })
  })

  it.each(AGE_CASES)('age $age joins from the profile, with no login minted', async (c) => {
    signedInMember = member({ date_of_birth: c.dob })
    const res = await settle(await post())
    expect(res).toEqual({
      status: 201,
      body: { success: true, eventSlug: 'colorado', eventTitle: 'Colorado', signInToken: null },
    })
    expect(rec.writes()).toEqual(joinWrites({ newcomer: false, withLogin: false }))
    const [row] = rec.payloads('insert', 'participants') as Row[]
    expect(row).toMatchObject({
      member_id: 'm-signed',
      date_of_birth: c.dob,
      event_role: c.minor ? 'participant' : 'mentor',
      age_bracket: c.minor ? 'high_school' : 'college',
    })
    expect(h.upsertMember).not.toHaveBeenCalled()
    expect(h.createUser).not.toHaveBeenCalled()
  })

  it('reads and writes in this order', async () => {
    signedInMember = member()
    expect((await post()).status).toBe(201)
    expect(rec.log).toEqual([
      'select group_join_tokens',
      'select members', // the signed-in profile
      'select participants',
      'select participants',
      'insert participants',
      'shadow participants [p-1]',
      'hook linkMembersToSchoolByName',
      'hook recordEventParticipation',
      'hook syncObjectSpaceRoster',
      'hook reconcileEventSpaceRoster',
      'hook dispatchAgreement',
      'select participants',
      'hook sendEmail',
      'hook ensureIndividualPayments',
    ])
  })
})
