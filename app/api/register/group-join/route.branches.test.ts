import { describe, it, expect, vi, beforeEach } from 'vitest'
import { rec, OPEN_EVENT, eqFilter, jsonRequest, settle, type DbCall, type DbResult } from '@/test/registration/fixtures'

// S5 A5: what route.characterisation.test.ts leaves unprotected by the handler
// split: every hook's arguments, the group-full and already-joined answers, the
// failed-insert answers, a Clerk or email failure, and the order of the checks
// around them. Written and passed against the route BEFORE it was split, then
// left unchanged by the split, so like that suite it says what the route does and
// a failure means the refactor changed behaviour. The two date-of-birth cases came
// from the split's review; they pass on the route as it was before the split too.

const h = vi.hoisted(() => ({
  getEventBySlug: vi.fn(),
  auth: vi.fn(),
  rateLimit: vi.fn(),
  consentBlock: vi.fn(),
  upsertMember: vi.fn(),
  provision: vi.fn(),
  linkSchool: vi.fn(),
  participation: vi.fn(),
  syncRoster: vi.fn(),
  reconcile: vi.fn(),
  dispatch: vi.fn(),
  sendEmail: vi.fn(),
  joinedEmail: vi.fn(),
  payments: vi.fn(),
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
vi.mock('@clerk/nextjs/server', () => ({ auth: h.auth }))
vi.mock('@/lib/clerk-provisioning', () => ({ ensureClerkUserAndSignInToken: h.provision }))
vi.mock('@/lib/pending-consent', () => ({ childAwaitingConsentBlock: h.consentBlock }))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: h.getEventBySlug }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: h.rateLimit, HOUR_MS: 3_600_000 }))
vi.mock('@/lib/member-sync', () => ({ upsertMember: h.upsertMember }))
vi.mock('@/lib/email', () => ({ sendEmail: h.sendEmail, groupMemberJoinedEmail: h.joinedEmail }))
vi.mock('@/lib/individual-payment', () => ({ ensureIndividualPayments: h.payments }))
vi.mock('@/lib/docusign-agreements', () => ({ dispatchAgreement: h.dispatch }))
vi.mock('@/lib/school-link', () => ({ linkMembersToSchoolByName: h.linkSchool }))
vi.mock('@/lib/event-participation-sync', () => ({ recordEventParticipation: h.participation }))
vi.mock('@/lib/space-inheritance', () => ({
  syncObjectSpaceRoster: h.syncRoster,
  reconcileEventSpaceRoster: h.reconcile,
}))

const { POST } = await import('./route')

type Row = Record<string, unknown>

const UNAVAILABLE = 'Registration is temporarily unavailable. Please try again shortly.'
const ALREADY_JOINED = 'You are already registered in this group.'
const GROUP_FULL = 'This group is already full — every place the organiser registered has been filled. Please contact your organiser if you think this is a mistake.'

const REG = {
  status: 'pending', withdrawn_at: null, school_name: 'Denver High',
  school_address_street: '1 Main', school_address_city: 'Denver', school_address_state: 'CO', school_address_zip: '80202',
  adult_count: 1, student_count: 2, member_pays_individually: false,
  teacher_email: 'teacher@example.com', teacher_first_name: 'T', teacher_poc_email: 'poc@example.com',
}

function linkRow(overrides: Row = {}, reg: Row = {}): Row {
  return {
    token: 'tok', registration_id: 'reg-1', event_slug: 'colorado', event_title: 'Colorado',
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    registrations: { ...REG, ...reg },
    ...overrides,
  }
}

const PROFILE = {
  id: 'm-signed', first_name: 'Mem', last_name: 'Ber', nickname: 'Memmy',
  email: 'member@example.com', school_email: 'member@school.example.com', phone: '555',
  date_of_birth: '1985-04-01', gender: 'female', grade: 'grade_9', tshirt_size: 'M',
  age_bracket: 'college', event_role: 'mentor',
  ec_first_name: 'E', ec_last_name: 'C', ec_email: 'ec@example.com', ec_phone: '556', ec_relationship: 'Spouse',
}

const DETAILS = {
  first_name: '  K ', last_name: ' Id  ', nickname: ' Kay ',
  email: 'kid@example.com', date_of_birth: '1985-04-01', type: 'Mentor', phone: ' 555 ',
  gender: 'Female', grade: '9', t_shirt_size: '3XL_plus',
  ethnicity: ['eth'], dietary_requirements: ['vegan'], health_conditions: ' asthma ',
  emergency_contact_first_name: ' P ', emergency_contact_last_name: ' Id ',
  emergency_contact_email: ' parent@example.com ', emergency_contact_phone: ' 556 ',
  emergency_contact_relationship: ' Parent ',
}

let link: Row | null
let linkError: unknown
let profile: Row | null
let more: (c: DbCall) => DbResult | undefined

const post = (details?: Row) =>
  POST(jsonRequest('/api/register/group-join', { token: 'tok', ...(details ? { details } : {}) }))

const callsTo = (table: string) => rec.calls.filter((c) => c.table === table)
const isDedupe = (c: DbCall) => c.table === 'participants' && c.op === 'select' && c.single === 'maybe'
const isCapacity = (c: DbCall) =>
  c.table === 'participants' && c.count && !c.filters.some((f) => f[0] === 'not')
const isJoinedCount = (c: DbCall) =>
  c.table === 'participants' && c.count && c.filters.some((f) => f[0] === 'not')
const participantInsert = () => rec.payloads('insert', 'participants')[0] as Row

beforeEach(() => {
  vi.clearAllMocks()
  rec.reset()
  link = linkRow()
  linkError = null
  profile = null
  more = () => undefined
  rec.respond((c) => {
    const overridden = more(c)
    if (overridden) return overridden
    if (c.table === 'group_join_tokens') return { data: link, error: linkError }
    if (c.table === 'members' && c.op === 'select' && eqFilter(c, 'is_active', true)) return { data: profile, error: null }
    return undefined
  })
  h.getEventBySlug.mockResolvedValue(OPEN_EVENT)
  h.auth.mockResolvedValue({ userId: null })
  h.rateLimit.mockReturnValue(null)
  h.consentBlock.mockResolvedValue(null)
  h.upsertMember.mockResolvedValue('m-1')
  h.provision.mockResolvedValue({ clerkUserId: 'user_new', signInToken: 'tkt' })
  h.joinedEmail.mockReturnValue({ subject: 's', html: 'h', text: 't' })
  h.sendEmail.mockResolvedValue(undefined)
})

describe('branches: POST /api/register/group-join — before the link is read', () => {
  it('a body that is not JSON is the no-token 400, ahead of the rate limit', async () => {
    const res = await POST(new Request('https://www.stellreducation.org/api/register/group-join', {
      method: 'POST', body: 'not json',
    }) as never)
    expect(await settle(res)).toEqual({ status: 400, body: { error: 'Token required' } })
    expect(h.rateLimit).not.toHaveBeenCalled()
    expect(rec.log).toEqual([])
  })

  it('a throttled caller gets the guard’s answer before any read', async () => {
    h.rateLimit.mockReturnValue(new Response(JSON.stringify({ error: 'slow' }), { status: 429 }))
    expect(await settle(await post(DETAILS))).toEqual({ status: 429, body: { error: 'slow' } })
    expect(rec.log).toEqual([])
    expect(h.getEventBySlug).not.toHaveBeenCalled()
  })
})

describe('branches: POST /api/register/group-join — the link', () => {
  it('reads the link by its token', async () => {
    await post(DETAILS)
    expect(eqFilter(callsTo('group_join_tokens')[0], 'token', 'tok')).toBe(true)
  })

  it('a failed read of the link is the unknown-link 404', async () => {
    link = null
    linkError = { message: 'boom' }
    expect(await settle(await post(DETAILS))).toEqual({
      status: 404, body: { error: 'Invalid or expired registration link' },
    })
  })

  it('a registration with only withdrawn_at set is withdrawn, before the event is looked up', async () => {
    link = linkRow({}, { withdrawn_at: '2026-01-01T00:00:00Z' })
    expect(await settle(await post(DETAILS))).toEqual({
      status: 410,
      body: { error: 'This group registration has been withdrawn and is no longer accepting participants.' },
    })
    expect(h.getEventBySlug).not.toHaveBeenCalled()
  })

  it('an expired link says expired, even for a withdrawn registration', async () => {
    link = linkRow({ expires_at: '2020-01-01T00:00:00Z' }, { status: 'withdrawn' })
    expect(await settle(await post(DETAILS))).toEqual({
      status: 410, body: { error: 'This registration link has expired' },
    })
  })

  it('looks the event up by the link’s slug', async () => {
    await post(DETAILS)
    expect(h.getEventBySlug).toHaveBeenCalledWith('colorado')
    expect(h.getEventBySlug).toHaveBeenCalledTimes(1)
  })
})

describe('branches: POST /api/register/group-join — a signed-in member', () => {
  beforeEach(() => {
    h.auth.mockResolvedValue({ userId: 'clerk-1' })
    profile = PROFILE
  })

  it('a child awaiting consent gets that answer before their profile is read', async () => {
    h.consentBlock.mockResolvedValue(new Response(JSON.stringify({ code: 'pending' }), { status: 403 }))
    expect(await settle(await post())).toEqual({ status: 403, body: { code: 'pending' } })
    expect(h.consentBlock).toHaveBeenCalledWith(expect.anything(), 'clerk-1')
    expect(rec.log).toEqual(['select group_join_tokens'])
  })

  it('the consent check runs after the event gate', async () => {
    h.getEventBySlug.mockResolvedValue(null)
    expect((await post()).status).toBe(403)
    expect(h.consentBlock).not.toHaveBeenCalled()
  })

  it('reads the active member for this login, and does no prior-member lookup, upsert or provisioning', async () => {
    expect((await post()).status).toBe(201)
    const members = callsTo('members')
    expect(members).toHaveLength(1)
    expect(eqFilter(members[0], 'clerk_user_id', 'clerk-1')).toBe(true)
    expect(eqFilter(members[0], 'is_active', true)).toBe(true)
    expect(h.upsertMember).not.toHaveBeenCalled()
    expect(h.provision).not.toHaveBeenCalled()
    expect(rec.payloads('update', 'members')).toEqual([])
  })

  it('the participant row, from the profile, field for field', async () => {
    await post()
    expect(participantInsert()).toEqual({
      registration_id: 'reg-1',
      member_id: 'm-signed',
      first_name: 'Mem',
      last_name: 'Ber',
      nickname: null,
      email: 'member@example.com',
      school_email: 'member@school.example.com',
      phone: '555',
      date_of_birth: '1985-04-01',
      grade: 'grade_9',
      gender: 'female',
      ethnicity: [],
      t_shirt_size: 'M',
      school_name: 'Denver High',
      age_bracket: 'college',
      event_role: 'mentor',
      dietary_requirements: [],
      health_conditions: null,
      emergency_contact_first_name: 'E',
      emergency_contact_last_name: 'C',
      emergency_contact_email: 'ec@example.com',
      emergency_contact_phone: '556',
      emergency_contact_relationship: 'Spouse',
      individual_payment_status: null,
      join_completed_at: expect.any(String),
    })
  })

  it('a sparse profile: empty phone and size, no role reads as participant', async () => {
    profile = { ...PROFILE, phone: null, tshirt_size: null, grade: null, gender: null, school_email: null, event_role: null }
    await post()
    expect(participantInsert()).toMatchObject({
      phone: '', t_shirt_size: '', grade: null, gender: null, school_email: null, event_role: 'participant',
    })
    expect(h.dispatch.mock.calls[0][1]).toMatchObject({ phone: undefined, grade: null, eventRole: 'participant' })
  })

  it('a stored date of birth with a time is used as the date alone', async () => {
    profile = { ...PROFILE, date_of_birth: '1985-04-01T00:00:00Z' }
    expect((await post()).status).toBe(201)
    expect(participantInsert().date_of_birth).toBe('1985-04-01')
    expect(h.dispatch.mock.calls[0][1]).toMatchObject({ dateOfBirth: '1985-04-01' })
  })

  it('the agreement, from the profile, field for field', async () => {
    await post()
    expect(h.dispatch).toHaveBeenCalledTimes(1)
    expect(h.dispatch.mock.calls[0][1]).toEqual({
      participantId: 'p-1',
      memberId: 'm-signed',
      eventSlug: 'colorado',
      eventTitle: 'Colorado',
      firstName: 'Mem',
      lastName: 'Ber',
      email: 'member@example.com',
      phone: '555',
      dateOfBirth: '1985-04-01',
      eventRole: 'mentor',
      schoolName: 'Denver High',
      schoolState: 'CO',
      guardianFirstName: 'E',
      guardianLastName: 'C',
      guardianEmail: 'ec@example.com',
      guardianPhone: '556',
      relationship: 'Spouse',
      grade: 'grade_9',
    })
  })
})

describe('branches: POST /api/register/group-join — a brand-new participant', () => {
  it('the consent check is not asked: there is no session', async () => {
    await post(DETAILS)
    expect(h.consentBlock).not.toHaveBeenCalled()
  })

  it('the member written, field for field, with existing rows left alone', async () => {
    await post(DETAILS)
    expect(h.upsertMember).toHaveBeenCalledTimes(1)
    expect(h.upsertMember.mock.calls[0][1]).toEqual({
      email: 'kid@example.com',
      school_email: null,
      first_name: 'K',
      last_name: 'Id',
      nickname: 'Kay',
      phone: '555',
      date_of_birth: '1985-04-01',
      gender: 'female',
      grade: 'grade_9',
      t_shirt_size: '3XL (or larger)',
      age_bracket: 'adult',
      event_role: 'mentor',
      health_conditions: 'asthma',
      ec_first_name: 'P',
      ec_last_name: 'Id',
      ec_email: 'parent@example.com',
      ec_phone: '556',
      ec_relationship: 'Parent',
    })
    expect(h.upsertMember.mock.calls[0][2]).toEqual({ onExisting: 'skip' })
  })

  it('a submitted date of birth with a time and spaces is stored and passed on as the date alone', async () => {
    expect((await post({ ...DETAILS, date_of_birth: ' 1985-04-01T00:00:00Z ' })).status).toBe(201)
    expect(h.upsertMember.mock.calls[0][1]).toMatchObject({ date_of_birth: '1985-04-01' })
    expect(participantInsert().date_of_birth).toBe('1985-04-01')
    expect(h.provision.mock.calls[0][3]).toMatchObject({ age: { dateOfBirth: '1985-04-01' } })
    expect(h.dispatch.mock.calls[0][1]).toMatchObject({ dateOfBirth: '1985-04-01' })
  })

  it('the participant row keeps dietary needs, and drops the submitted ethnicity and nickname', async () => {
    await post(DETAILS)
    expect(participantInsert()).toEqual({
      registration_id: 'reg-1',
      member_id: 'm-1',
      first_name: 'K',
      last_name: 'Id',
      nickname: null,
      email: 'kid@example.com',
      school_email: null,
      phone: '555',
      date_of_birth: '1985-04-01',
      grade: 'grade_9',
      gender: 'female',
      ethnicity: [],
      t_shirt_size: '3XL (or larger)',
      school_name: 'Denver High',
      age_bracket: 'adult',
      event_role: 'mentor',
      dietary_requirements: ['vegan'],
      health_conditions: 'asthma',
      emergency_contact_first_name: 'P',
      emergency_contact_last_name: 'Id',
      emergency_contact_email: 'parent@example.com',
      emergency_contact_phone: '556',
      emergency_contact_relationship: 'Parent',
      individual_payment_status: null,
      join_completed_at: expect.any(String),
    })
  })

  it('only a school address: it becomes the primary, and is also kept as the school address', async () => {
    const { email: _email, ...noEmail } = DETAILS
    expect((await post({ ...noEmail, school_email: 'Kid@School.example.com' })).status).toBe(201)
    expect(h.upsertMember.mock.calls[0][1]).toMatchObject({
      email: 'kid@school.example.com', school_email: 'kid@school.example.com',
    })
    // The address is its own third lookup only when it differs from the primary.
    expect(callsTo('members').filter((c) => c.op === 'select')).toHaveLength(2)
  })

  it('no type joins as a participant; a dietary list that is not a list is empty', async () => {
    await post({ ...DETAILS, type: '', dietary_requirements: 'vegan' })
    expect(participantInsert()).toMatchObject({ event_role: 'participant', dietary_requirements: [] })
  })

  it('names that are only whitespace are the required-fields 400', async () => {
    expect(await settle(await post({ ...DETAILS, first_name: '   ' }))).toEqual({
      status: 400, body: { error: 'First name, last name, email and date of birth are required.' },
    })
    expect(rec.log).toEqual(['select group_join_tokens'])
  })

  it('a new member is provisioned with the guard’s inputs, and the login linked to the row', async () => {
    const res = await settle(await post(DETAILS))
    expect(res.body).toMatchObject({ signInToken: 'tkt' })
    expect(h.provision).toHaveBeenCalledWith('kid@example.com', 'K', 'Id', {
      memberIsNew: true,
      age: { dateOfBirth: '1985-04-01' },
    })
    expect(rec.payloads('update', 'members')).toEqual([{ clerk_user_id: 'user_new' }])
    const loginLink = callsTo('members').find((c) => c.op === 'update')!
    expect(eqFilter(loginLink, 'id', 'm-1')).toBe(true)
  })

  it('someone already on file is provisioned as not new', async () => {
    more = (c) =>
      c.table === 'members' && c.op === 'select' && eqFilter(c, 'email', 'kid@example.com')
        ? { data: { id: 'm-prior' }, error: null }
        : undefined
    h.provision.mockResolvedValue({ clerkUserId: 'user_old', signInToken: null })
    const res = await settle(await post(DETAILS))
    expect(res.body).toMatchObject({ signInToken: null })
    expect(h.provision.mock.calls[0][3]).toMatchObject({ memberIsNew: false })
    expect(rec.payloads('update', 'members')).toEqual([])
  })

  it('a Clerk failure still joins, with no token and no link', async () => {
    h.provision.mockRejectedValue(new Error('clerk down'))
    const res = await settle(await post(DETAILS))
    expect(res).toEqual({
      status: 201,
      body: { success: true, eventSlug: 'colorado', eventTitle: 'Colorado', signInToken: null },
    })
    expect(rec.payloads('update', 'members')).toEqual([])
    expect(participantInsert()).toMatchObject({ member_id: 'm-1' })
  })

  it('identity is resolved before the group is checked', async () => {
    more = (c) => (isDedupe(c) ? { data: { id: 'p-old' }, error: null } : undefined)
    expect(await settle(await post(DETAILS))).toEqual({ status: 409, body: { error: ALREADY_JOINED } })
    expect(h.upsertMember).toHaveBeenCalledTimes(1)
    expect(h.provision).toHaveBeenCalledTimes(1)
    expect(rec.payloads('update', 'members')).toEqual([{ clerk_user_id: 'user_new' }])
  })
})

describe('branches: POST /api/register/group-join — admission', () => {
  it('already in this group, by registration and the joiner’s email: 409, with no count and no insert', async () => {
    more = (c) => (isDedupe(c) ? { data: { id: 'p-old' }, error: null } : undefined)
    expect(await settle(await post(DETAILS))).toEqual({ status: 409, body: { error: ALREADY_JOINED } })
    const dedupe = rec.calls.find(isDedupe)!
    expect(eqFilter(dedupe, 'registration_id', 'reg-1')).toBe(true)
    expect(eqFilter(dedupe, 'email', 'kid@example.com')).toBe(true)
    expect(rec.calls.some(isCapacity)).toBe(false)
    expect(rec.payloads('insert', 'participants')).toEqual([])
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('a failed dedupe read is the retryable 503', async () => {
    more = (c) => (isDedupe(c) ? { data: null, error: { message: 'boom' } } : undefined)
    expect(await settle(await post(DETAILS))).toEqual({ status: 503, body: { error: UNAVAILABLE } })
    expect(rec.payloads('insert', 'participants')).toEqual([])
  })

  it('a failed capacity count is the retryable 503', async () => {
    more = (c) => (isCapacity(c) ? { data: null, error: { message: 'boom' }, count: null } : undefined)
    expect(await settle(await post(DETAILS))).toEqual({ status: 503, body: { error: UNAVAILABLE } })
    expect(rec.payloads('insert', 'participants')).toEqual([])
  })

  it('the last place can be taken; the next is refused', async () => {
    more = (c) => (isCapacity(c) ? { data: null, error: null, count: 2 } : undefined)
    expect((await post(DETAILS)).status).toBe(201)
    expect(rec.payloads('insert', 'participants')).toHaveLength(1)

    more = (c) => (isCapacity(c) ? { data: null, error: null, count: 3 } : undefined)
    expect(await settle(await post(DETAILS))).toEqual({ status: 409, body: { error: GROUP_FULL } })
    expect(rec.payloads('insert', 'participants')).toHaveLength(1)
    const capacity = rec.calls.find(isCapacity)!
    expect(eqFilter(capacity, 'registration_id', 'reg-1')).toBe(true)
  })

  it.each([
    ['no adult count', { adult_count: null }],
    ['no student count', { student_count: null }],
  ])('%s: no cap, and no count is read', async (_l, reg) => {
    link = linkRow({}, reg)
    expect((await post(DETAILS)).status).toBe(201)
    expect(rec.calls.some(isCapacity)).toBe(false)
  })

  it('losing the insert race is the already-joined 409, and nothing follows', async () => {
    more = (c) =>
      c.table === 'participants' && c.op === 'insert' ? { data: null, error: { code: '23505', message: 'dup' } } : undefined
    expect(await settle(await post(DETAILS))).toEqual({ status: 409, body: { error: ALREADY_JOINED } })
    expect(rec.log.some((l) => l.startsWith('shadow '))).toBe(false)
    expect(h.linkSchool).not.toHaveBeenCalled()
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(h.payments).not.toHaveBeenCalled()
  })

  it.each([
    ['another insert error', { data: null, error: { code: '23514', message: 'no' } }],
    ['no row back', { data: null, error: null }],
  ])('%s is the 500, and nothing follows', async (_l, result) => {
    more = (c) => (c.table === 'participants' && c.op === 'insert' ? result : undefined)
    expect(await settle(await post(DETAILS))).toEqual({
      status: 500, body: { error: 'Failed to complete registration. Please try again.' },
    })
    expect(rec.log.some((l) => l.startsWith('shadow '))).toBe(false)
    expect(h.linkSchool).not.toHaveBeenCalled()
    expect(h.dispatch).not.toHaveBeenCalled()
  })
})

describe('branches: POST /api/register/group-join — after the row', () => {
  it('school, event activity and the Space rosters get the link’s values', async () => {
    await post(DETAILS)
    expect(h.linkSchool).toHaveBeenCalledWith(expect.anything(), ['m-1'], {
      name: 'Denver High',
      address_street: '1 Main',
      address_city: 'Denver',
      address_state: 'CO',
      address_zip: '80202',
    }, { replace: true })
    expect(h.participation).toHaveBeenCalledWith(expect.anything(), {
      memberId: 'm-1', eventSlug: 'colorado', eventTitle: 'Colorado', registrationId: 'reg-1',
    })
    expect(h.syncRoster).toHaveBeenCalledWith(expect.anything(), 'event', 'colorado', 'm-1')
    expect(h.reconcile).toHaveBeenCalledWith(expect.anything(), 'colorado')
  })

  it('a registration with no school or address: blank row, nulls for the link, nothing on the agreement', async () => {
    link = linkRow({}, {
      school_name: null, school_address_street: null, school_address_city: null,
      school_address_state: null, school_address_zip: null,
    })
    await post(DETAILS)
    expect(participantInsert()).toMatchObject({ school_name: '' })
    expect(h.linkSchool.mock.calls[0][2]).toEqual({
      name: null, address_street: null, address_city: null, address_state: null, address_zip: null,
    })
    expect(h.dispatch.mock.calls[0][1]).toMatchObject({ schoolName: undefined, schoolState: undefined })
  })

  it('the organiser’s email: the joiner, the joined count and the declared size', async () => {
    more = (c) => (isJoinedCount(c) ? { data: null, error: null, count: 2 } : undefined)
    await post(DETAILS)
    const joined = rec.calls.find(isJoinedCount)!
    expect(eqFilter(joined, 'registration_id', 'reg-1')).toBe(true)
    expect(joined.filters).toContainEqual(['not', 'join_completed_at', 'is', null])
    expect(h.joinedEmail).toHaveBeenCalledWith({
      registrantFirstName: 'T',
      memberFirstName: 'K',
      memberLastName: 'Id',
      memberEmail: 'kid@example.com',
      eventTitle: 'Colorado',
      memberCount: 2,
      totalExpected: 3,
    })
    expect(h.sendEmail).toHaveBeenCalledWith({
      to: 'teacher@example.com', cc: ['poc@example.com'], subject: 's', html: 'h', text: 't',
    })
  })

  it('no declared size counts as 1 adult and 2 students; an unread count as 1; no contact means no cc', async () => {
    link = linkRow({}, { adult_count: null, student_count: null, teacher_poc_email: null })
    more = (c) => (isJoinedCount(c) ? { data: null, error: null, count: null } : undefined)
    await post(DETAILS)
    expect(h.joinedEmail.mock.calls[0][0]).toMatchObject({ memberCount: 1, totalExpected: 3 })
    expect(h.sendEmail.mock.calls[0][0]).toMatchObject({ cc: [] })
  })

  it.each([
    ['sending', () => h.sendEmail.mockRejectedValue(new Error('resend down'))],
    ['building', () => h.joinedEmail.mockImplementation(() => { throw new Error('bad template') })],
  ])('a failure %s the organiser’s email does not stop the join or the payment step', async (_l, arrange) => {
    arrange()
    const res = await post(DETAILS)
    expect(res.status).toBe(201)
    expect(h.payments).toHaveBeenCalledTimes(1)
  })

  it('the payment step gets this registration and this person', async () => {
    await post(DETAILS)
    expect(h.payments).toHaveBeenCalledWith(expect.anything(), 'reg-1', [{
      participantId: 'p-1', email: 'kid@example.com', firstName: 'K', lastName: 'Id',
    }])
  })

  it.each([
    ['linking the school', () => h.linkSchool, ['dispatch', 'payments']],
    ['the agreement', () => h.dispatch, ['payments']],
    ['the payment step', () => h.payments, []],
  ] as const)('a throw from %s is not caught here', async (_l, hook, notReached) => {
    hook().mockRejectedValueOnce(new Error('boom'))
    await expect(post(DETAILS)).rejects.toThrow('boom')
    for (const name of notReached) expect(h[name]).not.toHaveBeenCalled()
  })
})
