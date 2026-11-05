import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  rec, AGE_CASES, OPEN_EVENT, CLOSED_EVENT, EVENT_UNDER_WAY, EVENT_A_YEAR_OUT,
  DOB_18_TODAY, DOB_18_TOMORROW, DOB_13_TOMORROW, DOB_MISSING_SELF, DOB_INVALID_SELF,
  VIEW_AS_REFUSED, viewAsRefusal, eqFilter, jsonRequest, settle,
} from '@/test/registration/fixtures'

// S5 A1: characterisation of POST /api/register/individual as it stands on
// 4 Nov 2026. The S5 handler split (A4) must keep every expectation here
// unchanged: status, `code`, body, and the order of writes and side effects.
// If one of these fails, the refactor changed behaviour; fix the refactor, not
// this file. A deliberate behaviour change updates this file in its own commit.
// A test named KNOWN DEFECT is the exception: it records what happens, and is
// not a contract to preserve.
//
// What is real: the route, lib/registration-eligibility, lib/registration (the
// window), lib/clerk-provisioning (the COPPA login guard; only Clerk is faked)
// and lib/member-enums. Everything with an outside effect is faked and logs
// itself into `rec`.
//
// Not pinned here, so unprotected when A4 splits this route: the scholarship
// branches, the merch add-on lines, the resume and email-link duplicate answers,
// and the checkout failure paths. route.test.ts covers the scholarship offer and
// consent block; the duplicate rules live in lib/registration-duplicates.

const h = vi.hoisted(() => ({
  getEventBySlug: vi.fn(async (_slug: string): Promise<unknown> => null),
  getCurrentMember: vi.fn(async (): Promise<{ email: string } | null> => null),
  impersonation: vi.fn(async (): Promise<Response | null> => null),
  consentBlock: vi.fn(async (): Promise<Response | null> => null),
  resolveDuplicate: vi.fn((_rows: unknown, _o: unknown): { kind: string; registration?: unknown } => ({ kind: 'none' })),
  linkSchool: vi.fn(async (_db: unknown, _ids: string[], _s: unknown) => ({ state: 'CO' })),
  dispatch: vi.fn(async (_db: unknown, _a: Record<string, unknown>) => {}),
  getUserList: vi.fn(async () => ({ data: [] as Array<{ id: string }> })),
  createUser: vi.fn(async () => ({ id: 'user_new' })),
  createSignInToken: vi.fn(async () => ({ token: 'tkt' })),
  priceRetrieve: vi.fn(async (_id: string): Promise<{ unit_amount: number }> => ({ unit_amount: 2500 })),
  stripeOn: false,
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
vi.mock('@/lib/pending-consent', async (orig) => {
  const real = await orig<typeof import('@/lib/pending-consent')>()
  return { ...real, sessionChildAwaitingConsentBlock: h.consentBlock }
})
vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: null }),
  clerkClient: async () => ({
    users: { getUserList: h.getUserList, createUser: h.createUser },
    signInTokens: { createSignInToken: h.createSignInToken },
  }),
}))
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: () => {} }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: () => null, HOUR_MS: 3_600_000 }))
vi.mock('@/lib/scholarships', () => ({ findOfferByToken: async () => null, attachOfferToRegistration: async () => {} }))
vi.mock('@/lib/stripe', () => ({
  stripeClient: () => (h.stripeOn ? { prices: { retrieve: h.priceRetrieve } } : null),
}))
vi.mock('@/lib/registration-duplicates', () => ({
  findExistingRegistrations: async () => new Map(),
  resolveDuplicate: h.resolveDuplicate,
}))
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
  return {
    resolveAndLinkSchool: async (db: unknown, ids: string[], s: unknown) => {
      rec.event('hook resolveAndLinkSchool')
      return h.linkSchool(db, ids, s)
    },
  }
})
vi.mock('@/lib/member-profile-options', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return { syncMemberOptionSelections: async () => { rec.event('hook syncMemberOptionSelections') } }
})
vi.mock('@/lib/event-participation-sync', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return { recordEventParticipation: async () => { rec.event('hook recordEventParticipation') } }
})
vi.mock('@/lib/auto-membership-grant', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return { autoGrantBaseMembership: async () => { rec.event('hook autoGrantBaseMembership') } }
})
vi.mock('@/lib/store/event-merch', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return {
    prepareRegistrationAddons: async () => { rec.event('hook prepareRegistrationAddons'); return [] },
    addRegistrationAddons: async () => { rec.event('hook addRegistrationAddons') },
  }
})
vi.mock('@/lib/registration-confirm', () => ({ confirmRegistration: async () => {} }))
vi.mock('@/lib/registration-pay-link', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return {
    sendPayLinkEmail: async () => { rec.event('hook sendPayLinkEmail'); return { sent: false, recipients: [] } },
  }
})
vi.mock('@/lib/registration-checkout', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return {
    createRegistrationCheckout: async () => {
      rec.event('hook createRegistrationCheckout')
      return { url: 'https://checkout.test' }
    },
    RegistrationCheckoutError: class extends Error {},
    ensurePayToken: async () => 'paytok',
    mintPayToken: () => 'paytok',
    payPageUrl: () => 'https://www.stellreducation.org/pay',
    pendingAddonLines: async () => [],
  }
})

const { POST } = await import('./route')

function post(overrides: Record<string, unknown> = {}) {
  return POST(jsonRequest('/api/register/individual', {
    event_slug: 'colorado', event_title: 'Client Title',
    email: 'kid@example.com', first_name: 'K', last_name: 'Id',
    phone: '555', date_of_birth: '1985-04-01', school_name: 'Denver High',
    grade: '9', gender: 'female', t_shirt_size: 'M',
    event_role: 'mentor', age_bracket: 'college',
    emergency_contact_first_name: 'P', emergency_contact_last_name: 'Id',
    emergency_contact_email: 'parent@example.com', emergency_contact_phone: '556',
    emergency_contact_relationship: 'Parent',
    ...overrides,
  }))
}

/** Writes and side effects of a successful signed-out registration, in order. */
function happyWrites(withLogin: boolean) {
  return [
    'insert registrations',
    'upsert members',
    'shadow members [m-1]',
    'hook resolveAndLinkSchool',
    'hook syncMemberOptionSelections',
    'insert participants',
    'shadow participants [p-1]',
    'hook recordEventParticipation',
    'hook autoGrantBaseMembership',
    'hook dispatchAgreement',
    ...(withLogin ? ['update members'] : []),
    'hook prepareRegistrationAddons',
  ]
}

/** A member already on file, found by this column and value. */
function priorMember(column: string, value: string, id = 'm-prior') {
  rec.respond((c) =>
    c.table === 'members' && c.op === 'select' && eqFilter(c, column, value)
      ? { data: { id }, error: null }
      : undefined,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  rec.reset()
  h.stripeOn = false
  h.getEventBySlug.mockResolvedValue(OPEN_EVENT)
  h.getCurrentMember.mockResolvedValue(null)
  h.impersonation.mockResolvedValue(null)
  h.consentBlock.mockResolvedValue(null)
  h.resolveDuplicate.mockReturnValue({ kind: 'none' })
  h.priceRetrieve.mockResolvedValue({ unit_amount: 2500 })
  h.getUserList.mockResolvedValue({ data: [] })
})

describe('characterisation: POST /api/register/individual — view-as', () => {
  it('an admin viewing as a member is refused before any read, session lookup or write', async () => {
    h.impersonation.mockResolvedValue(viewAsRefusal())
    expect(await settle(await post())).toEqual(VIEW_AS_REFUSED)
    expect(rec.log).toEqual([])
    expect(h.consentBlock).not.toHaveBeenCalled()
    expect(h.getCurrentMember).not.toHaveBeenCalled()
    expect(h.getEventBySlug).not.toHaveBeenCalled()
    expect(h.getUserList).not.toHaveBeenCalled()
    expect(h.createUser).not.toHaveBeenCalled()
  })
})

// The rule that makes an anonymous POST safe (deep review C-1, C-3): naming a
// member already on file gets no session, writes no clerk_user_id and rewrites
// nothing on their row.
describe('characterisation: POST /api/register/individual — a member already on file', () => {
  const NO_MEMBER_WRITES = [
    'insert registrations',
    'hook resolveAndLinkSchool',
    'insert participants',
    'shadow participants [p-1]',
    'hook recordEventParticipation',
    'hook autoGrantBaseMembership',
    'hook dispatchAgreement',
    'hook prepareRegistrationAddons',
  ]

  it.each([
    ['their email', 'email', 'kid@example.com', {}],
    ['their school email', 'school_email', 'kid@example.com', {}],
    ['the school address submitted beside a new email', 'email', 'old@school.example.com', { school_email: 'old@school.example.com' }],
  ])('found by %s: linked, no login, and their row untouched', async (_l, column, value, extra) => {
    priorMember(column, value)
    expect(await settle(await post(extra))).toEqual({
      status: 201,
      body: { registrationId: 'reg-1', checkoutUrl: null, signInToken: null },
    })
    expect(rec.writes()).toEqual(NO_MEMBER_WRITES)
    expect(rec.payloads('upsert', 'members')).toEqual([])
    expect(rec.payloads('update', 'members')).toEqual([])
    expect(h.getUserList).not.toHaveBeenCalled()
    expect(h.createUser).not.toHaveBeenCalled()
    expect(h.createSignInToken).not.toHaveBeenCalled()
    // Linked to the prior member; no school is linked to them.
    const [row] = rec.payloads('insert', 'participants') as Record<string, unknown>[]
    expect(row).toMatchObject({ member_id: 'm-prior', email: 'kid@example.com' })
    expect(h.linkSchool.mock.calls[0][1]).toEqual([])
    expect(h.dispatch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ memberId: 'm-prior' }))
  })

  it('a new member whose email already has a Clerk login gets no token and no link', async () => {
    h.getUserList.mockResolvedValue({ data: [{ id: 'user_existing' }] })
    expect(await settle(await post())).toEqual({
      status: 201,
      body: { registrationId: 'reg-1', checkoutUrl: null, signInToken: null },
    })
    expect(rec.writes()).toEqual(happyWrites(false))
    expect(h.createUser).not.toHaveBeenCalled()
    expect(h.createSignInToken).not.toHaveBeenCalled()
  })

  // The route comment says "a lookup error leaves this false, so no token is
  // minted". It does not: the error field is discarded, so a failed read is
  // "not found", the existing member's row is upserted over, and a caller whose
  // email has no Clerk login gets a ticket and a clerk_user_id write onto it.
  it('KNOWN DEFECT, fails open: a failed prior-member lookup reads as new, with a rewrite and a login', async () => {
    rec.respond((c) =>
      c.table === 'members' && c.op === 'select' ? { data: null, error: { message: 'boom' } } : undefined,
    )
    expect(await settle(await post())).toEqual({
      status: 201,
      body: { registrationId: 'reg-1', checkoutUrl: null, signInToken: 'tkt' },
    })
    expect(rec.writes()).toEqual(happyWrites(true))
  })
})

describe('characterisation: POST /api/register/individual — a signed-in member', () => {
  const SESSION_EMAIL = 'session@example.com'

  beforeEach(() => {
    h.getCurrentMember.mockResolvedValue({ email: 'Session@Example.com' })
  })

  it('the session email replaces the submitted one, and they rewrite their own row with no login', async () => {
    priorMember('email', SESSION_EMAIL)
    expect(await settle(await post({ email: 'other@example.com' }))).toEqual({
      status: 201,
      body: { registrationId: 'reg-1', checkoutUrl: null, signInToken: null },
    })
    expect(rec.writes()).toEqual(happyWrites(false))
    const [member] = rec.payloads('upsert', 'members') as Record<string, unknown>[]
    expect(member.email).toBe(SESSION_EMAIL)
    const [row] = rec.payloads('insert', 'participants') as Record<string, unknown>[]
    expect(row).toMatchObject({ email: SESSION_EMAIL, member_id: 'm-1' })
    expect(h.dispatch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ email: SESSION_EMAIL }))
    expect(h.resolveDuplicate).toHaveBeenCalledWith(undefined, { sessionMatches: true })
    expect(h.getUserList).not.toHaveBeenCalled()
    expect(h.createUser).not.toHaveBeenCalled()
  })

  it('a member found only by the other address is linked, never rewritten, even when signed in', async () => {
    priorMember('school_email', SESSION_EMAIL)
    await post()
    expect(rec.payloads('upsert', 'members')).toEqual([])
    const [row] = rec.payloads('insert', 'participants') as Record<string, unknown>[]
    expect(row.member_id).toBe('m-prior')
    expect(h.linkSchool.mock.calls[0][1]).toEqual([])
  })

  it('with no member on file, the row is created and still no login is made', async () => {
    expect((await post()).status).toBe(201)
    expect(rec.writes()).toEqual(happyWrites(false))
    expect(h.getUserList).not.toHaveBeenCalled()
  })
})

describe('characterisation: POST /api/register/individual — a priced event', () => {
  const PRICED = { ...OPEN_EVENT, stripePriceId: 'price_1' }

  beforeEach(() => {
    h.stripeOn = true
    h.getEventBySlug.mockResolvedValue(PRICED)
  })

  it('the fee is stored, then the checkout and pay link come last', async () => {
    expect(await settle(await post())).toEqual({
      status: 201,
      body: { registrationId: 'reg-1', checkoutUrl: 'https://checkout.test', signInToken: 'tkt' },
    })
    expect(h.priceRetrieve).toHaveBeenCalledWith('price_1')
    expect(rec.writes()).toEqual([
      ...happyWrites(true),
      'hook createRegistrationCheckout',
      'hook sendPayLinkEmail',
    ])
    const [reg] = rec.payloads('insert', 'registrations') as Record<string, unknown>[]
    expect(reg).toMatchObject({ status: 'pending', amount_due_cents: 2500 })
  })

  it('a price Stripe cannot resolve is a 503 before anything is written', async () => {
    h.priceRetrieve.mockRejectedValue(new Error('no such price'))
    expect(await settle(await post())).toEqual({
      status: 503,
      body: { error: 'This event’s registration fee is misconfigured — please contact support before registering.' },
    })
    expect(rec.writes()).toEqual([])
  })
})

describe('characterisation: POST /api/register/individual — a duplicate', () => {
  it('someone already registered is a 409 with nothing written', async () => {
    h.resolveDuplicate.mockReturnValue({
      kind: 'already_registered',
      registration: { registrationId: 'reg-old', type: 'individual' },
    })
    expect(await settle(await post())).toEqual({
      status: 409,
      body: {
        code: 'already_registered',
        error: 'kid@example.com is already registered for this event. If that’s you, sign in to see it under Account → Events.',
      },
    })
    expect(rec.writes()).toEqual([])
  })
})

describe('characterisation: POST /api/register/individual — which date age is taken on', () => {
  it('under 18 on the first day of an event under way is a minor, though an adult today', async () => {
    h.getEventBySlug.mockResolvedValue(EVENT_UNDER_WAY)
    expect((await post({ date_of_birth: DOB_18_TODAY })).status).toBe(201)
    const [member] = rec.payloads('upsert', 'members') as Record<string, unknown>[]
    expect(member).toMatchObject({ event_role: 'participant', age_bracket: 'high_school' })
    const [row] = rec.payloads('insert', 'participants') as Record<string, unknown>[]
    expect(row.event_role).toBe('participant')
  })

  it('under 18 today is a minor, though an adult by the event', async () => {
    h.getEventBySlug.mockResolvedValue(EVENT_A_YEAR_OUT)
    expect((await post({ date_of_birth: DOB_18_TOMORROW })).status).toBe(201)
    const [member] = rec.payloads('upsert', 'members') as Record<string, unknown>[]
    expect(member).toMatchObject({ event_role: 'participant', age_bracket: 'high_school' })
  })

  it('the login guard goes on today, not the event: under 13 now gets no login, though 13 by the event', async () => {
    h.getEventBySlug.mockResolvedValue(EVENT_A_YEAR_OUT)
    const res = await settle(await post({ date_of_birth: DOB_13_TOMORROW }))
    expect(res).toEqual({ status: 201, body: { registrationId: 'reg-1', checkoutUrl: null, signInToken: null } })
    expect(h.createUser).not.toHaveBeenCalled()
  })
})

describe('characterisation: POST /api/register/individual — event gate', () => {
  it('a Sanity outage is a 503 with nothing written', async () => {
    h.getEventBySlug.mockRejectedValue(new Error('sanity timeout'))
    expect(await settle(await post())).toEqual({
      status: 503,
      body: { error: 'Registration is temporarily unavailable. Please try again shortly.' },
    })
    expect(rec.log).toEqual([])
  })

  it('an unknown slug is a 404 with nothing written', async () => {
    h.getEventBySlug.mockResolvedValue(null)
    expect(await settle(await post())).toEqual({ status: 404, body: { error: 'Event not found' } })
    expect(rec.log).toEqual([])
  })

  it('a closed window is a 403 with nothing written', async () => {
    h.getEventBySlug.mockResolvedValue(CLOSED_EVENT)
    expect(await settle(await post())).toEqual({
      status: 403,
      body: { error: 'Registration is not open for this event.' },
    })
    expect(rec.log).toEqual([])
  })

  it('the window is checked before the date of birth', async () => {
    h.getEventBySlug.mockResolvedValue(CLOSED_EVENT)
    expect((await post({ date_of_birth: '' })).status).toBe(403)
  })

  it('a campaign is refused (400) after the age check, with nothing written', async () => {
    h.getEventBySlug.mockResolvedValue({ ...OPEN_EVENT, activityType: 'campaign', registrationOpen: true })
    expect(await settle(await post())).toEqual({
      status: 400,
      body: {
        error: 'Campaigns are entered as a group, not by individual students. Please use the group registration form.',
      },
    })
    expect(rec.writes()).toEqual([])
  })
})

describe('characterisation: POST /api/register/individual — date of birth', () => {
  it.each([
    ['missing', undefined, 'dob_missing', DOB_MISSING_SELF],
    ['blank', '', 'dob_missing', DOB_MISSING_SELF],
    ['not a date', 'abc', 'dob_invalid', DOB_INVALID_SELF],
    ['no such day', '2013-02-30', 'dob_invalid', DOB_INVALID_SELF],
    ['in the future', '2999-01-01', 'dob_invalid', DOB_INVALID_SELF],
  ])('a %s date of birth is a 400 with its code, and nothing is written', async (_l, dob, code, error) => {
    expect(await settle(await post({ date_of_birth: dob }))).toEqual({ status: 400, body: { code, error } })
    expect(rec.log).toEqual([])
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(h.createUser).not.toHaveBeenCalled()
  })

  it.each(AGE_CASES)('age $age is accepted with today’s role, bracket, login and write order', async (c) => {
    const res = await settle(await post({ date_of_birth: c.dob }))
    // Under 13 gets no login and no token (COPPA guard); everyone else new gets both.
    expect(res).toEqual({
      status: 201,
      body: { registrationId: 'reg-1', checkoutUrl: null, signInToken: c.under13 ? null : 'tkt' },
    })
    expect(rec.writes()).toEqual(happyWrites(!c.under13))
    expect(h.createUser).toHaveBeenCalledTimes(c.under13 ? 0 : 1)

    const role = c.minor ? 'participant' : 'mentor'
    const [member] = rec.payloads('upsert', 'members') as Record<string, unknown>[]
    expect(member).toMatchObject({
      date_of_birth: c.dob,
      event_role: role,
      age_bracket: c.minor ? 'high_school' : 'college',
    })
    const [participant] = rec.payloads('insert', 'participants') as Record<string, unknown>[]
    // The participant keeps the SUBMITTED bracket; only the role is forced.
    expect(participant).toMatchObject({ date_of_birth: c.dob, event_role: role, age_bracket: 'college' })
    expect(h.dispatch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ dateOfBirth: c.dob, eventRole: role, participantId: 'p-1', memberId: 'm-1' }),
    )
  })
})

describe('characterisation: POST /api/register/individual — rows written', () => {
  it('writes this registration, member and participant, reads and all, in this order', async () => {
    expect((await post()).status).toBe(201)
    expect(rec.log).toEqual([
      'insert registrations',
      'select members', // prior member by email
      'select members', // prior member by school_email
      'upsert members',
      'shadow members [m-1]',
      'hook resolveAndLinkSchool',
      'hook syncMemberOptionSelections',
      'insert participants',
      'shadow participants [p-1]',
      'hook recordEventParticipation',
      'hook autoGrantBaseMembership',
      'hook dispatchAgreement',
      'update members',
      'hook prepareRegistrationAddons',
    ])
  })

  it('the registration row: server title, pending, free, with a pay token', async () => {
    await post()
    expect(rec.payloads('insert', 'registrations')).toEqual([{
      event_slug: 'colorado',
      event_title: 'Colorado',
      type: 'individual',
      status: 'pending',
      amount_due_cents: 0,
      invoice_requested: false,
      pay_token: 'paytok',
      teacher_first_name: null,
      teacher_last_name: null,
      teacher_email: null,
      school_name: null,
      school_address_street: null,
      school_address_city: null,
      school_address_state: null,
      school_address_zip: null,
      withdrawn_at: null,
    }])
  })

  it('the participant row, field for field', async () => {
    await post()
    expect(rec.payloads('insert', 'participants')).toEqual([{
      registration_id: 'reg-1',
      member_id: 'm-1',
      first_name: 'K', last_name: 'Id', nickname: null,
      email: 'kid@example.com', school_email: null, phone: '555',
      date_of_birth: '1985-04-01', grade: '9', gender: 'female',
      ethnicity: [],
      t_shirt_size: 'M', school_name: 'Denver High', age_bracket: 'college',
      event_role: 'mentor',
      dietary_requirements: [],
      health_conditions: null,
      emergency_contact_first_name: 'P', emergency_contact_last_name: 'Id',
      emergency_contact_email: 'parent@example.com', emergency_contact_phone: '556',
      emergency_contact_relationship: 'Parent',
    }])
  })

  it('the Clerk id is linked to the new member only when a token was minted', async () => {
    await post()
    expect(rec.calls.find((c) => c.op === 'update' && c.table === 'members')).toMatchObject({
      payload: { clerk_user_id: 'user_new' },
      filters: [['eq', 'id', 'm-1']],
    })
  })

  it('a failed participant insert deletes the registration and is a 500', async () => {
    rec.respond((c) =>
      c.op === 'insert' && c.table === 'participants' ? { data: null, error: { message: 'boom' } } : undefined,
    )
    expect(await settle(await post())).toEqual({
      status: 500,
      body: { error: 'Failed to save participant details' },
    })
    expect(rec.writes()).toEqual([
      'insert registrations',
      'upsert members',
      'shadow members [m-1]',
      'hook resolveAndLinkSchool',
      'hook syncMemberOptionSelections',
      'insert participants',
      'delete registrations',
    ])
  })

  it('a failed registration insert is a 500 before any member is written', async () => {
    rec.respond((c) =>
      c.op === 'insert' && c.table === 'registrations' ? { data: null, error: { message: 'boom' } } : undefined,
    )
    expect(await settle(await post())).toEqual({ status: 500, body: { error: 'Failed to create registration' } })
    expect(rec.writes()).toEqual(['insert registrations'])
  })
})
