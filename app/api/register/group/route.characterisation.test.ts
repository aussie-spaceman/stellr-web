import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  rec, AGE_CASES, OPEN_EVENT, CLOSED_EVENT, EVENT_UNDER_WAY, EVENT_A_YEAR_OUT,
  DOB_18_TODAY, DOB_18_TOMORROW, DOB_13_TOMORROW, DOB_MISSING_SELF, DOB_INVALID_SELF,
  VIEW_AS_REFUSED, viewAsRefusal, inFilter, dobMissingFor, dobInvalidFor, jsonRequest, settle,
} from '@/test/registration/fixtures'

// S5 A1: characterisation of POST /api/register/group as it stands on
// 4 Nov 2026, for both the add_now and the spreadsheet details methods. The S5
// handler split (A6) must keep every expectation here unchanged: status,
// `code`, body, and the order of writes and side effects. In particular every
// person is age-checked BEFORE the first write, and the writes run
// registration → members → participants. If one of these fails, the refactor
// changed behaviour; fix the refactor, not this file.
//
// What is real: the route, lib/registration-eligibility, lib/registration (the
// window), lib/clerk-provisioning (the COPPA login guard; only Clerk is faked),
// lib/event-pricing and lib/member-enums. Everything with an outside effect is
// faked and logs itself into `rec`. The event is free (no Stripe price) and
// Stripe is off, so the money paths stay out of scope: route.test.ts covers them.

const h = vi.hoisted(() => ({
  getEventBySlug: vi.fn(async (_slug: string): Promise<unknown> => null),
  getCurrentMember: vi.fn(async (): Promise<{ email: string } | null> => null),
  impersonation: vi.fn(async (): Promise<Response | null> => null),
  followUp: vi.fn(async (_db: unknown, _input: Record<string, unknown>) => ({})),
  getUserList: vi.fn(async () => ({ data: [] as Array<{ id: string }> })),
  createUser: vi.fn(async () => ({ id: 'user_new' })),
  createSignInToken: vi.fn(async () => ({ token: 'tkt' })),
  onFile: null as Record<string, unknown> | null,
  afterTasks: [] as Array<() => Promise<unknown>>,
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
vi.mock('@/lib/sanity', () => ({ getEventBySlug: h.getEventBySlug }))
vi.mock('@/lib/community', () => ({ getCurrentMember: h.getCurrentMember }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: h.impersonation }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => null }))
vi.mock('@/lib/registration-duplicates', () => ({
  findExistingRegistrations: async () => new Map(),
  resolveDuplicate: () => ({ kind: 'none' }),
}))
vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: async () => ({
    users: { getUserList: h.getUserList, createUser: h.createUser },
    signInTokens: { createSignInToken: h.createSignInToken },
  }),
}))
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: () => {} }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: () => null, HOUR_MS: 3_600_000 }))
vi.mock('@/lib/after-response', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return {
    runAfterResponse: (label: string, task: () => Promise<unknown>) => {
      rec.event(`after-response ${label}`)
      h.afterTasks.push(task)
    },
  }
})
vi.mock('@/lib/group-registration-followup', () => ({ runGroupRegistrationFollowUp: h.followUp }))
vi.mock('@/lib/email', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return {
    sendEmail: async () => { rec.event('hook sendEmail') },
    groupConfirmationEmail: () => ({ subject: '', html: '', text: '' }),
  }
})
vi.mock('@/lib/individual-payment', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return { ensureIndividualPayments: async () => { rec.event('hook ensureIndividualPayments') } }
})
vi.mock('@/lib/store/event-merch', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return { finalizeRegistrationMerch: async () => { rec.event('hook finalizeRegistrationMerch') } }
})
vi.mock('@/lib/google-sheets', () => ({
  isGoogleSheetsConfigured: () => false,
  createGroupRegistrationSheet: async () => ({ url: '', spreadsheetId: '' }),
}))
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
vi.mock('@/lib/member-profile-options', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return { syncMemberOptionSelections: async () => { rec.event('hook syncMemberOptionSelections') } }
})
vi.mock('@/lib/auto-membership-grant', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return { autoGrantBaseMembership: async () => { rec.event('hook autoGrantBaseMembership') } }
})
vi.mock('@/lib/member-onfile', () => ({ getMemberOnFileByMembershipId: async () => h.onFile }))
vi.mock('@/lib/registration-pay-link', () => ({ sendPayLinkEmail: async () => ({ sent: false, recipients: [] }) }))
vi.mock('@/lib/registration-checkout', () => ({
  createRegistrationCheckout: async () => ({ url: 'https://checkout.test/cs_1' }),
  RegistrationCheckoutError: class extends Error {},
  ensurePayToken: async () => 'paytok',
  mintPayToken: () => 'paytok',
  payPageUrl: () => 'https://www.stellreducation.org/pay',
}))

const { POST } = await import('./route')

type Person = Record<string, unknown>

/** A student entered on the form. Role and bracket are adult so the minor override shows. */
const student = (n: string, overrides: Person = {}): Person => ({
  email: `s${n}@example.com`, first_name: 'Stu', last_name: `Dent${n}`,
  date_of_birth: '2011-01-01', phone: '', gender: '', t_shirt_size: '',
  age_bracket: 'college', event_role: 'mentor',
  emergency_contact_email: `parent${n}@example.com`,
  ...overrides,
})

function body(overrides: Person = {}, teacher: Person = {}): Person {
  return {
    event_slug: 'colorado',
    event_title: 'Client Title',
    registrant_role: 'teacher',
    teacher: {
      email: 'teacher@example.com', first_name: 'T', last_name: 'Eacher',
      school_name: 'Denver High', date_of_birth: '1980-01-01',
      phone: '', gender: '', t_shirt_size: '', age_bracket: 'adult',
      ...teacher,
    },
    adult_count: 1, student_count: 2, total_participants: 3,
    details_method: 'add_now',
    payment_method: 'none',
    additional_adults: [],
    students: [student('1'), student('2')],
    school_dpa_agreed: true,
    ...overrides,
  }
}

const post = (b: Person) => POST(jsonRequest('/api/register/group', b))

const JOIN_URL = expect.stringMatching(/\/register\/colorado\/join\/[a-f0-9]{64}$/)

const M = (email: string) => `m-${email}`
const TEACHER = 'teacher@example.com'

/**
 * Writes and side effects of a free add_now registration, in order. `created` is
 * the members this request makes; the rest of `memberEmails` were already on file.
 */
function addNowWrites(memberEmails: string[], participantCount: number, withLogin: boolean, created = memberEmails) {
  const times = (label: string) => memberEmails.map(() => label)
  return [
    'insert registrations',
    'upsert members',
    `shadow members [${created.map(M).join(',')}]`,
    'hook linkMembersToSchoolByName',
    ...times('hook recordEventParticipation'),
    ...times('hook syncObjectSpaceRoster'),
    'hook reconcileEventSpaceRoster',
    ...times('hook autoGrantBaseMembership'),
    'hook syncMemberOptionSelections',
    'update registrations',
    ...(withLogin ? ['update members'] : []),
    'insert participants',
    `shadow participants [${Array.from({ length: participantCount }, (_, i) => `p-${i}`).join(',')}]`,
    'after-response register/group',
    'insert group_join_tokens',
    'hook finalizeRegistrationMerch',
    'hook sendEmail',
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  rec.reset()
  h.afterTasks.length = 0
  h.onFile = null
  h.getEventBySlug.mockResolvedValue(OPEN_EVENT)
  h.getCurrentMember.mockResolvedValue(null)
  h.impersonation.mockResolvedValue(null)
  h.getUserList.mockResolvedValue({ data: [] })
})

describe('characterisation: POST /api/register/group — view-as', () => {
  it('an admin viewing as a member is refused before any read, session lookup or write', async () => {
    h.impersonation.mockResolvedValue(viewAsRefusal())
    expect(await settle(await post(body()))).toEqual(VIEW_AS_REFUSED)
    expect(rec.log).toEqual([])
    expect(h.getCurrentMember).not.toHaveBeenCalled()
    expect(h.getEventBySlug).not.toHaveBeenCalled()
    expect(h.createUser).not.toHaveBeenCalled()
  })
})

describe('characterisation: POST /api/register/group — a signed-in registrant', () => {
  const SESSION_EMAIL = 'session@example.com'
  const ALL = [SESSION_EMAIL, 's1@example.com', 's2@example.com']

  beforeEach(() => {
    h.getCurrentMember.mockResolvedValue({ email: 'Session@Example.com' })
  })

  it('the session email replaces the submitted one everywhere, with no Clerk call and no token', async () => {
    expect(await settle(await post(body()))).toEqual({
      status: 201,
      body: { registrationId: 'reg-1', checkoutUrl: null, spreadsheetUrl: null, joinUrl: JOIN_URL, signInToken: null },
    })
    expect(rec.writes()).toEqual(addNowWrites(ALL, 3, false))
    const [reg] = rec.payloads('insert', 'registrations') as Person[]
    expect(reg.teacher_email).toBe(SESSION_EMAIL)
    const [members] = rec.payloads('upsert', 'members') as Person[][]
    expect(members[0].email).toBe(SESSION_EMAIL)
    const [rows] = rec.payloads('insert', 'participants') as Person[][]
    expect(rows[0]).toMatchObject({ email: SESSION_EMAIL, member_id: M(SESSION_EMAIL) })
    expect(h.getUserList).not.toHaveBeenCalled()
    expect(h.createUser).not.toHaveBeenCalled()
  })

  it('a registrant already on file is linked and not rewritten, even when signed in', async () => {
    rec.respond((c) =>
      c.table === 'members' && c.op === 'select' && inFilter(c, 'email', SESSION_EMAIL)
        ? { data: [{ id: 'm-prior', email: SESSION_EMAIL }], error: null }
        : undefined,
    )
    await post(body())
    const [members] = rec.payloads('upsert', 'members') as Person[][]
    expect(members.map((m) => m.email)).toEqual(['s1@example.com', 's2@example.com'])
    const [rows] = rec.payloads('insert', 'participants') as Person[][]
    expect(rows[0].member_id).toBe('m-prior')
  })
})

// The rule that makes an anonymous POST safe (deep review C-1, C-3): naming a
// member already on file gets no session, writes no clerk_user_id and rewrites
// nothing on their row.
describe('characterisation: POST /api/register/group — a member already on file', () => {
  const OLD_ADDRESS = 'old@school.example.com'
  const ALL = [TEACHER, 's1@example.com', 's2@example.com']
  const NEW_STUDENTS = ['s1@example.com', 's2@example.com']

  it.each([
    ['their email', 'email', TEACHER, {}, { id: 'm-prior', email: TEACHER }],
    ['their school email', 'school_email', TEACHER, {}, { id: 'm-prior', school_email: TEACHER }],
    ['the school address submitted beside a new email', 'email', OLD_ADDRESS, { school_email: OLD_ADDRESS }, { id: 'm-prior', email: OLD_ADDRESS }],
  ])('the registrant found by %s: linked, no login, and their row untouched', async (_l, column, value, teacher, found) => {
    rec.respond((c) =>
      c.table === 'members' && c.op === 'select' && inFilter(c, column, value)
        ? { data: [found], error: null }
        : undefined,
    )
    expect(await settle(await post(body({}, teacher)))).toEqual({
      status: 201,
      body: { registrationId: 'reg-1', checkoutUrl: null, spreadsheetUrl: null, joinUrl: JOIN_URL, signInToken: null },
    })
    expect(rec.writes()).toEqual(addNowWrites(ALL, 3, false, NEW_STUDENTS))
    const [members] = rec.payloads('upsert', 'members') as Person[][]
    expect(members.map((m) => m.email)).toEqual(NEW_STUDENTS)
    expect(rec.payloads('update', 'members')).toEqual([])
    expect(rec.payloads('update', 'registrations')).toEqual([{ teacher_member_id: 'm-prior' }])
    const [rows] = rec.payloads('insert', 'participants') as Person[][]
    expect(rows[0]).toMatchObject({ email: TEACHER, member_id: 'm-prior' })
    expect(h.getUserList).not.toHaveBeenCalled()
    expect(h.createUser).not.toHaveBeenCalled()
    expect(h.createSignInToken).not.toHaveBeenCalled()
  })

  it('a student on file is linked and not rewritten, and the new registrant still gets a login', async () => {
    rec.respond((c) =>
      c.table === 'members' && c.op === 'select' && inFilter(c, 'email', 's1@example.com')
        ? { data: [{ id: 'm-prior', email: 's1@example.com' }], error: null }
        : undefined,
    )
    const { body: res } = await settle(await post(body()))
    expect(res).toMatchObject({ signInToken: 'tkt' })
    const [members] = rec.payloads('upsert', 'members') as Person[][]
    expect(members.map((m) => m.email)).toEqual([TEACHER, 's2@example.com'])
    const [rows] = rec.payloads('insert', 'participants') as Person[][]
    expect(rows[1]).toMatchObject({ email: 's1@example.com', member_id: 'm-prior' })
  })

  it('a new registrant whose email already has a Clerk login gets no token and no link', async () => {
    h.getUserList.mockResolvedValue({ data: [{ id: 'user_existing' }] })
    const { body: res } = await settle(await post(body()))
    expect(res).toMatchObject({ signInToken: null })
    expect(rec.writes()).toEqual(addNowWrites(ALL, 3, false))
    expect(h.createUser).not.toHaveBeenCalled()
    expect(h.createSignInToken).not.toHaveBeenCalled()
  })

  it('a failed member preload fails safe: no member written, no login, participants unlinked', async () => {
    rec.respond((c) =>
      c.table === 'members' && c.op === 'select' ? { data: null, error: { message: 'boom' } } : undefined,
    )
    const { status, body: res } = await settle(await post(body()))
    expect(status).toBe(201)
    expect(res).toMatchObject({ signInToken: null })
    expect(rec.writes()).toEqual([
      'insert registrations',
      'shadow members []',
      'hook linkMembersToSchoolByName',
      'hook reconcileEventSpaceRoster',
      'hook syncMemberOptionSelections',
      'insert participants',
      'shadow participants [p-0,p-1,p-2]',
      'after-response register/group',
      'insert group_join_tokens',
      'hook finalizeRegistrationMerch',
      'hook sendEmail',
    ])
    const [rows] = rec.payloads('insert', 'participants') as Person[][]
    expect(rows.map((r) => r.member_id)).toEqual([null, null, null])
    expect(h.getUserList).not.toHaveBeenCalled()
  })

  // Neither school-address read may count a failure as "not found": someone on
  // file only by school address would read as new, with a duplicate member and a
  // login. The registration is taken back and nothing else is written.
  it.each([
    ['school_email column', 'school_email', TEACHER, {}],
    ['submitted school address', 'email', OLD_ADDRESS, { school_email: OLD_ADDRESS }],
  ])('a failed %s read is a retryable 503 with nothing kept', async (_l, column, value, teacher) => {
    rec.respond((c) =>
      c.table === 'members' && c.op === 'select' && inFilter(c, column, value)
        ? { data: null, error: { message: 'boom' } }
        : undefined,
    )
    expect(await settle(await post(body({}, teacher)))).toEqual({
      status: 503,
      body: { error: 'Registration is temporarily unavailable. Please try again shortly.' },
    })
    expect(rec.writes()).toEqual(['insert registrations', 'delete registrations'])
    expect(h.getUserList).not.toHaveBeenCalled()
    expect(h.createUser).not.toHaveBeenCalled()
    expect(h.createSignInToken).not.toHaveBeenCalled()
  })

  it('a delete that fails on the way out is logged with the registration id, and is still the 503', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    rec.respond((c) => {
      if (c.table === 'members' && c.op === 'select' && inFilter(c, 'school_email', TEACHER)) return { data: null, error: { message: 'boom' } }
      if (c.table === 'registrations' && c.op === 'delete') return { data: null, error: { message: 'also boom' } }
      return undefined
    })
    expect((await post(body())).status).toBe(503)
    expect(errors).toHaveBeenCalledWith('[register/group] could not take back registration', 'reg-1', { message: 'also boom' })
    errors.mockRestore()
  })
})

describe('characterisation: POST /api/register/group — the follow-up after the response', () => {
  it('waits for the response, then gets the event date and every person’s agreement details', async () => {
    const minorDob = AGE_CASES[2].dob
    await post(body({
      students: [student('1', { date_of_birth: minorDob }), student('2', { date_of_birth: '1985-04-01' })],
    }))
    expect(h.followUp).not.toHaveBeenCalled()
    await h.afterTasks[0]()
    expect(h.followUp).toHaveBeenCalledTimes(1)
    const shared = {
      eventSlug: 'colorado', eventTitle: 'Colorado', schoolName: 'Denver High', grade: null,
      guardianFirstName: null, guardianLastName: null, guardianPhone: null, relationship: null,
    }
    expect(h.followUp.mock.calls[0][1]).toEqual({
      eventSlug: 'colorado',
      eventTitle: 'Colorado',
      eventDate: OPEN_EVENT.date,
      organiserName: 'T Eacher',
      deadline: expect.any(Number),
      people: [
        {
          isRegistrant: true,
          agreement: {
            ...shared, participantId: 'p-0', memberId: M(TEACHER), firstName: 'T', lastName: 'Eacher',
            email: TEACHER, phone: '', dateOfBirth: '1980-01-01', eventRole: 'teacher', guardianEmail: null,
          },
        },
        {
          isRegistrant: false,
          agreement: {
            ...shared, participantId: 'p-1', memberId: M('s1@example.com'), firstName: 'Stu', lastName: 'Dent1',
            email: 's1@example.com', phone: '', dateOfBirth: minorDob, eventRole: 'participant',
            guardianEmail: 'parent1@example.com',
          },
        },
        {
          isRegistrant: false,
          agreement: {
            ...shared, participantId: 'p-2', memberId: M('s2@example.com'), firstName: 'Stu', lastName: 'Dent2',
            email: 's2@example.com', phone: '', dateOfBirth: '1985-04-01', eventRole: 'mentor',
            guardianEmail: 'parent2@example.com',
          },
        },
      ],
    })
  })
})

describe('characterisation: POST /api/register/group — which date age is taken on', () => {
  const withStudent = (dob: string) => body({ students: [student('1', { date_of_birth: dob }), student('2')] })

  it('under 18 on the first day of an event under way is a minor, though an adult today', async () => {
    h.getEventBySlug.mockResolvedValue(EVENT_UNDER_WAY)
    expect((await post(withStudent(DOB_18_TODAY))).status).toBe(201)
    const [members] = rec.payloads('upsert', 'members') as Person[][]
    expect(members[1]).toMatchObject({ event_role: 'participant', age_bracket: 'high_school' })
    const [rows] = rec.payloads('insert', 'participants') as Person[][]
    expect(rows[1].event_role).toBe('participant')
  })

  it('under 18 today is a minor, though an adult by the event', async () => {
    h.getEventBySlug.mockResolvedValue(EVENT_A_YEAR_OUT)
    expect((await post(withStudent(DOB_18_TOMORROW))).status).toBe(201)
    const [members] = rec.payloads('upsert', 'members') as Person[][]
    expect(members[1]).toMatchObject({ event_role: 'participant', age_bracket: 'high_school' })
    const [rows] = rec.payloads('insert', 'participants') as Person[][]
    expect(rows[1].event_role).toBe('participant')
  })

  it('the login guard goes on today, not the event: a registrant under 13 now gets no login, though 13 by the event', async () => {
    h.getEventBySlug.mockResolvedValue(EVENT_A_YEAR_OUT)
    const { body: res } = await settle(await post(body({}, { date_of_birth: DOB_13_TOMORROW })))
    expect(res).toMatchObject({ signInToken: null })
    expect(h.createUser).not.toHaveBeenCalled()
  })
})

describe('characterisation: POST /api/register/group — event gate', () => {
  it('a Sanity outage is a 503 with nothing written', async () => {
    h.getEventBySlug.mockRejectedValue(new Error('sanity timeout'))
    expect(await settle(await post(body()))).toEqual({
      status: 503,
      body: { error: 'Registration is temporarily unavailable. Please try again shortly.' },
    })
    expect(rec.log).toEqual([])
  })

  it('an unknown slug is a 404 with nothing written', async () => {
    h.getEventBySlug.mockResolvedValue(null)
    expect(await settle(await post(body()))).toEqual({ status: 404, body: { error: 'Event not found' } })
    expect(rec.log).toEqual([])
  })

  it('a closed window is a 403 with nothing written', async () => {
    h.getEventBySlug.mockResolvedValue(CLOSED_EVENT)
    expect(await settle(await post(body()))).toEqual({
      status: 403,
      body: { error: 'Registration is not open for this event.' },
    })
    expect(rec.log).toEqual([])
  })

  it('the window is checked before any date of birth', async () => {
    h.getEventBySlug.mockResolvedValue(CLOSED_EVENT)
    const res = await post(body({ students: [student('1', { date_of_birth: '' }), student('2')] }, { date_of_birth: '' }))
    expect(res.status).toBe(403)
  })
})

describe('characterisation: POST /api/register/group — the registrant’s date of birth', () => {
  it.each([
    ['missing', undefined, 'dob_missing', DOB_MISSING_SELF],
    ['blank', '', 'dob_missing', DOB_MISSING_SELF],
    ['not a date', 'abc', 'dob_invalid', DOB_INVALID_SELF],
    ['in the future', '2999-01-01', 'dob_invalid', DOB_INVALID_SELF],
  ])('a %s one is a 400 with its code, and nothing is written', async (_l, dob, code, error) => {
    expect(await settle(await post(body({}, { date_of_birth: dob })))).toEqual({ status: 400, body: { code, error } })
    expect(rec.log).toEqual([])
  })

  it.each(AGE_CASES)('a teacher aged $age registers, keeps the teacher role, and gets a login unless under 13', async (c) => {
    const res = await settle(await post(body({}, { date_of_birth: c.dob })))
    expect(res).toEqual({
      status: 201,
      body: { registrationId: 'reg-1', checkoutUrl: null, spreadsheetUrl: null, joinUrl: JOIN_URL, signInToken: c.under13 ? null : 'tkt' },
    })
    const emails = [TEACHER, 's1@example.com', 's2@example.com']
    expect(rec.writes()).toEqual(addNowWrites(emails, 3, !c.under13))
    const [members] = rec.payloads('upsert', 'members') as Person[][]
    expect(members[0]).toMatchObject({
      email: TEACHER, date_of_birth: c.dob, event_role: 'teacher', age_bracket: c.minor ? 'high_school' : 'adult',
    })
    const [rows] = rec.payloads('insert', 'participants') as Person[][]
    expect(rows[0]).toMatchObject({ email: TEACHER, date_of_birth: c.dob, event_role: 'teacher', age_bracket: 'adult' })
  })

  it('a student manager aged 12 registers as a student manager, with no login', async () => {
    const c = AGE_CASES[0]
    const res = await settle(await post(body(
      {
        registrant_role: 'student_manager',
        teacher_poc: { first_name: 'P', last_name: 'Oc', email: 'poc@example.com' },
        adult_count: 0, student_count: 2, total_participants: 3,
      },
      { date_of_birth: c.dob, age_bracket: 'high_school' },
    )))
    expect(res).toEqual({
      status: 201,
      body: { registrationId: 'reg-1', checkoutUrl: null, spreadsheetUrl: null, joinUrl: JOIN_URL, signInToken: null },
    })
    const [rows] = rec.payloads('insert', 'participants') as Person[][]
    expect(rows[0]).toMatchObject({ email: TEACHER, event_role: 'school_student_manager' })
    expect(h.createUser).not.toHaveBeenCalled()
  })
})

describe('characterisation: POST /api/register/group — add_now people’s dates of birth', () => {
  it.each([
    ['missing', undefined, 'dob_missing', dobMissingFor('Stu Dent2')],
    ['blank', '', 'dob_missing', dobMissingFor('Stu Dent2')],
    ['not a date', 'abc', 'dob_invalid', dobInvalidFor('Stu Dent2')],
    ['in the future', '2999-01-01', 'dob_invalid', dobInvalidFor('Stu Dent2')],
  ])('one %s date of birth is a 400 naming the person, and NOTHING is written', async (_l, dob, code, error) => {
    const res = await settle(await post(body({ students: [student('1'), student('2', { date_of_birth: dob })] })))
    expect(res).toEqual({ status: 400, body: { code, error } })
    expect(rec.log).toEqual([])
    expect(h.createUser).not.toHaveBeenCalled()
  })

  it('an additional adult is checked too', async () => {
    const res = await settle(await post(body({
      adult_count: 2, total_participants: 4,
      additional_adults: [student('9', { first_name: 'Ada', last_name: 'Ult', date_of_birth: 'abc' })],
    })))
    expect(res).toEqual({ status: 400, body: { code: 'dob_invalid', error: dobInvalidFor('Ada Ult') } })
    expect(rec.log).toEqual([])
  })

  // The answer for a Member ID slot depends only on what was submitted: one refusal
  // for an unknown ID, a wrong last name and a record with no usable date of birth,
  // naming nobody from the record.
  describe('a Member ID that cannot be used', () => {
    const LINKED = { memberId: 'm-linked', first_name: 'Lin', last_name: 'Ked', member_last_name: 'Ked', email: 'linked@example.com', ethnicity: [], dietary_requirements: [] }
    const slot = (extra: Person = {}): Person => ({
      linked: true, existing_membership_id: 'STL-1', first_name: 'Sub', last_name: 'Mitted', ...extra,
    })
    const REFUSAL = {
      status: 400,
      body: {
        code: 'dob_missing',
        error: "We couldn't use the Stellr Member ID for Sub Mitted. Check the ID and last name, or enter their details by hand. If both are right, ask them to check their date of birth with Stellr.",
      },
    }

    it.each([
      ['an unknown ID', null, slot()],
      ['a wrong last name', { ...LINKED, date_of_birth: '2008-01-01' }, slot()],
      ['no date of birth on file', { ...LINKED, date_of_birth: null }, slot({ last_name: 'Ked' })],
      ['an unreadable date of birth on file', { ...LINKED, date_of_birth: '2999-01-01' }, slot({ last_name: 'Ked' })],
    ])('%s gets the one refusal, before any write', async (_l, onFile, sent) => {
      h.onFile = onFile
      const res = await settle(await post(body({ students: [student('1'), sent] })))
      const name = `${sent.first_name} ${sent.last_name}`
      expect(res).toEqual({ ...REFUSAL, body: { ...REFUSAL.body, error: REFUSAL.body.error.replace('Sub Mitted', name) } })
      expect(JSON.stringify(res)).not.toContain('Lin')
      expect(rec.log).toEqual([])
    })

    it('no last name at all is refused the same way, so a bare ID finds nothing', async () => {
      h.onFile = { ...LINKED, date_of_birth: '2008-01-01' }
      const res = await settle(await post(body({
        students: [student('1'), { linked: true, existing_membership_id: 'STL-1' }],
      })))
      expect(res).toMatchObject({ status: 400, body: { code: 'dob_missing' } })
      expect(JSON.stringify(res)).toContain('one person')
      expect(JSON.stringify(res)).not.toContain('Lin')
      expect(rec.log).toEqual([])
    })

    it.each([
      ['an unknown ID', null],
      ['a wrong last name', { ...LINKED, date_of_birth: '2008-01-01' }],
      ['no date of birth on file', { ...LINKED, member_last_name: 'Mitted', date_of_birth: null }],
      ['an unreadable date of birth on file', { ...LINKED, member_last_name: 'Mitted', date_of_birth: '2999-01-01' }],
    ])('with details typed in, %s goes ahead on what was typed, unlinked', async (_l, onFile) => {
      h.onFile = onFile
      const typed = slot({ email: 'typed@example.com', date_of_birth: '2010-02-02', emergency_contact_email: 'parent@example.com' })
      expect((await post(body({ students: [student('1'), typed] }))).status).toBe(201)
      const [rows] = rec.payloads('insert', 'participants') as Person[][]
      expect(rows[2]).toMatchObject({ email: 'typed@example.com', first_name: 'Sub', last_name: 'Mitted', date_of_birth: '2010-02-02', member_id: M('typed@example.com') })
    })

    it('a date of birth typed badly is that person’s usual refusal, whatever the ID names', async () => {
      h.onFile = { ...LINKED, date_of_birth: '2008-01-01' }
      const res = await settle(await post(body({ students: [student('1'), slot({ date_of_birth: 'abc' })] })))
      expect(res).toEqual({ status: 400, body: { code: 'dob_invalid', error: dobInvalidFor('Sub Mitted') } })
    })

    it('a name that matches only the latest participant row gets the one refusal', async () => {
      h.onFile = { ...LINKED, last_name: 'Latest', member_last_name: 'Ked', date_of_birth: '2008-01-01' }
      const sent = slot({ last_name: 'Latest' })
      const res = await settle(await post(body({ students: [student('1'), sent] })))
      expect(res).toEqual({ ...REFUSAL, body: { ...REFUSAL.body, error: REFUSAL.body.error.replace('Sub Mitted', 'Sub Latest') } })
      expect(rec.log).toEqual([])
    })

    it.each([
      ['an unknown ID', null, {}],
      ['a wrong last name', { ...LINKED, date_of_birth: '2008-01-01' }, {}],
      ['no ID at all', null, { existing_membership_id: undefined }],
    ])('typed details are checked like anyone else’s: an invalid email with %s', async (_l, onFile, extra) => {
      h.onFile = onFile
      const typed = slot({ email: 'not-an-email', date_of_birth: '2010-02-02', ...extra })
      const res = await settle(await post(body({ students: [student('1'), typed] })))
      expect(res.status).toBe(400)
      expect(JSON.stringify(res.body)).toContain('The email for Sub Mitted')
      expect(rec.log).toEqual([])
    })

    it('typed details are checked like anyone else’s: an invalid guardian email', async () => {
      h.onFile = null
      const typed = slot({ email: 'typed@example.com', date_of_birth: '2010-02-02', emergency_contact_email: 'none' })
      const res = await settle(await post(body({ students: [student('1'), typed] })))
      expect(res.status).toBe(400)
      expect(JSON.stringify(res.body)).toContain('parent or guardian email for Sub Mitted')
      expect(rec.log).toEqual([])
    })
  })

  describe('a member id in the request body', () => {
    it('never links a typed slot', async () => {
      const typed = student('2', { _linked_member_id: 'm-other' })
      expect((await post(body({ students: [student('1'), typed] }))).status).toBe(201)
      const [rows] = rec.payloads('insert', 'participants') as Person[][]
      expect(rows[2]).toMatchObject({ email: 's2@example.com', member_id: M('s2@example.com') })
    })

    it('never links the registrant', async () => {
      expect((await post(body({}, { _linked_member_id: 'm-other' }))).status).toBe(201)
      const [rows] = rec.payloads('insert', 'participants') as Person[][]
      expect(rows[0]).toMatchObject({ email: TEACHER, member_id: M(TEACHER) })
    })
  })

  // What the form sends after an accepted lookup: the ID and the confirmed name.
  describe('a Member ID confirmed by last name', () => {
    const ONFILE = {
      memberId: 'm-linked', first_name: 'Lin', last_name: 'Latest', member_last_name: 'Ked', email: 'linked@example.com',
      date_of_birth: '2010-03-03', ethnicity: [], dietary_requirements: [],
    }
    const slot = (last_name: string): Person => ({ linked: true, existing_membership_id: 'STL-1', first_name: 'Lin', last_name })

    it.each([
      ['the member row’s name, which the lookup confirms', 'Ked'],
      ['in any case, with stray spaces', '  kED '],
    ])('links to the record and writes from it: %s', async (_l, name) => {
      h.onFile = ONFILE
      expect((await post(body({ students: [student('1'), slot(name)] }))).status).toBe(201)
      const [rows] = rec.payloads('insert', 'participants') as Person[][]
      expect(rows[2]).toMatchObject({
        email: 'linked@example.com', first_name: 'Lin', last_name: 'Latest', date_of_birth: '2010-03-03', member_id: 'm-linked',
      })
      const [members] = rec.payloads('upsert', 'members') as Person[][]
      expect(members.map((m) => m.email)).not.toContain('linked@example.com')
    })
  })

  it.each(AGE_CASES)('a student aged $age is accepted; a minor is forced to participant / high school', async (c) => {
    const res = await settle(await post(body({ students: [student('1', { date_of_birth: c.dob }), student('2')] })))
    expect(res).toEqual({
      status: 201,
      body: { registrationId: 'reg-1', checkoutUrl: null, spreadsheetUrl: null, joinUrl: JOIN_URL, signInToken: 'tkt' },
    })
    expect(rec.writes()).toEqual(addNowWrites([TEACHER, 's1@example.com', 's2@example.com'], 3, true))
    const role = c.minor ? 'participant' : 'mentor'
    const [members] = rec.payloads('upsert', 'members') as Person[][]
    expect(members[1]).toMatchObject({
      email: 's1@example.com', date_of_birth: c.dob, event_role: role, age_bracket: c.minor ? 'high_school' : 'college',
    })
    const [rows] = rec.payloads('insert', 'participants') as Person[][]
    // The participant keeps the SUBMITTED bracket; only the role is forced.
    expect(rows[1]).toMatchObject({ email: 's1@example.com', date_of_birth: c.dob, event_role: role, age_bracket: 'college' })
  })
})

describe('characterisation: POST /api/register/group — rows written (add_now)', () => {
  it('reads and writes in this order', async () => {
    expect((await post(body())).status).toBe(201)
    expect(rec.log).toEqual([
      'insert registrations',
      'select members', // which of these emails already have a member
      'select members', // the unmatched ones by school_email
      'upsert members',
      `shadow members [${M(TEACHER)},${M('s1@example.com')},${M('s2@example.com')}]`,
      'hook linkMembersToSchoolByName',
      'hook recordEventParticipation', 'hook recordEventParticipation', 'hook recordEventParticipation',
      'hook syncObjectSpaceRoster', 'hook syncObjectSpaceRoster', 'hook syncObjectSpaceRoster',
      'hook reconcileEventSpaceRoster',
      'hook autoGrantBaseMembership', 'hook autoGrantBaseMembership', 'hook autoGrantBaseMembership',
      'hook syncMemberOptionSelections',
      'update registrations',
      'update members',
      'insert participants',
      'shadow participants [p-0,p-1,p-2]',
      'after-response register/group',
      'insert group_join_tokens',
      'hook finalizeRegistrationMerch',
      'hook sendEmail',
    ])
    // The agreements wait for the response.
    expect(h.afterTasks).toHaveLength(1)
  })

  it('the registration row: server title, free event confirmed, no pay token', async () => {
    await post(body())
    const [reg] = rec.payloads('insert', 'registrations') as Person[]
    expect(reg).toEqual({
      event_slug: 'colorado',
      event_title: 'Colorado',
      type: 'group',
      status: 'confirmed',
      amount_due_cents: 0,
      adult_count: 1,
      student_count: 2,
      teacher_first_name: 'T',
      teacher_last_name: 'Eacher',
      teacher_email: TEACHER,
      school_name: 'Denver High',
      school_address_street: undefined,
      school_address_city: undefined,
      school_address_state: undefined,
      school_address_zip: undefined,
      invoice_requested: false,
      pay_token: null,
      registrant_role: 'teacher',
      teacher_poc_first_name: null,
      teacher_poc_last_name: null,
      teacher_poc_email: null,
      member_pays_individually: false,
      details_method: 'add_now',
      withdrawn_at: null,
      school_dpa_agreed_at: expect.any(String),
      school_data_terms_version: expect.any(String),
      school_data_terms_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  })

  it('participants go in as one insert, registrant first, in form order', async () => {
    await post(body())
    const inserts = rec.payloads('insert', 'participants') as Person[][]
    expect(inserts).toHaveLength(1)
    expect(inserts[0].map((r) => [r.email, r.member_id, r.registration_id])).toEqual([
      [TEACHER, M(TEACHER), 'reg-1'],
      ['s1@example.com', M('s1@example.com'), 'reg-1'],
      ['s2@example.com', M('s2@example.com'), 'reg-1'],
    ])
  })

  it('the registrant is linked to the registration, then their new Clerk id to their member', async () => {
    await post(body())
    const updates = rec.calls.filter((c) => c.op === 'update')
    expect(updates.map((c) => [c.table, c.payload, c.filters])).toEqual([
      ['registrations', { teacher_member_id: M(TEACHER) }, [['eq', 'id', 'reg-1']]],
      ['members', { clerk_user_id: 'user_new' }, [['eq', 'id', M(TEACHER)]]],
    ])
  })

  it('a failed participant insert deletes the registration and is a 500 (members stay)', async () => {
    rec.respond((c) =>
      c.op === 'insert' && c.table === 'participants' ? { data: null, error: { message: 'boom' } } : undefined,
    )
    expect(await settle(await post(body()))).toEqual({
      status: 500,
      body: { error: 'Failed to save participant details' },
    })
    const writes = rec.writes()
    expect(writes.slice(-2)).toEqual(['insert participants', 'delete registrations'])
    expect(writes).toContain('upsert members')
    expect(writes).not.toContain('insert group_join_tokens')
  })

  it('a failed registration insert is a 500 before any member is written', async () => {
    rec.respond((c) =>
      c.op === 'insert' && c.table === 'registrations' ? { data: null, error: { message: 'boom' } } : undefined,
    )
    expect(await settle(await post(body()))).toEqual({ status: 500, body: { error: 'Failed to create registration' } })
    expect(rec.writes()).toEqual(['insert registrations'])
  })
})

describe('characterisation: POST /api/register/group — spreadsheet method', () => {
  // The roster comes later, so only the registrant is checked and written now.
  const sheet = (students: Person[]) => body({ details_method: 'spreadsheet', students })

  it('people in the body are not age-checked or written: only the registrant is', async () => {
    const res = await settle(await post(sheet([student('1', { date_of_birth: 'abc' }), student('2', { date_of_birth: '' })])))
    expect(res).toEqual({
      status: 201,
      body: { registrationId: 'reg-1', checkoutUrl: null, spreadsheetUrl: null, joinUrl: JOIN_URL, signInToken: 'tkt' },
    })
    expect(rec.writes()).toEqual(addNowWrites([TEACHER], 1, true))
    const [rows] = rec.payloads('insert', 'participants') as Person[][]
    expect(rows.map((r) => r.email)).toEqual([TEACHER])
    const [reg] = rec.payloads('insert', 'registrations') as Person[]
    expect(reg).toMatchObject({ details_method: 'spreadsheet', adult_count: 1, student_count: 2 })
  })

  it('the registrant is still age-checked', async () => {
    const res = await settle(await post(body({ details_method: 'spreadsheet', students: [] }, { date_of_birth: '' })))
    expect(res).toEqual({ status: 400, body: { code: 'dob_missing', error: DOB_MISSING_SELF } })
    expect(rec.log).toEqual([])
  })

  it.each(AGE_CASES)('a teacher aged $age registers by spreadsheet, with a login unless under 13', async (c) => {
    const res = await settle(await post(body({ details_method: 'spreadsheet', students: [] }, { date_of_birth: c.dob })))
    expect(res).toEqual({
      status: 201,
      body: { registrationId: 'reg-1', checkoutUrl: null, spreadsheetUrl: null, joinUrl: JOIN_URL, signInToken: c.under13 ? null : 'tkt' },
    })
    expect(rec.writes()).toEqual(addNowWrites([TEACHER], 1, !c.under13))
  })
})
