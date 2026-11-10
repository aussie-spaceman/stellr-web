import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import Stripe from 'stripe'
import { rec, OPEN_EVENT, inFilter, jsonRequest, settle } from '@/test/registration/fixtures'
import { maskEmail } from '@/lib/utils'

// S5 A6: what route.characterisation.test.ts and route.test.ts leave unprotected
// by the handler split: the order of the shape checks, each duplicate answer, the
// price checks, every hook's arguments, the sheet, the join link, the invoice and
// card branches, and the confirmation email. Written and passed against the route
// BEFORE it was split, then left unchanged by the split, so like those suites it
// says what the route does and a failure means the refactor changed behaviour.

const h = vi.hoisted(() => ({
  serviceClient: vi.fn(),
  getEventBySlug: vi.fn(),
  getCurrentMember: vi.fn(),
  impersonation: vi.fn(),
  rateLimit: vi.fn(),
  auth: vi.fn(),
  stripe: null as unknown,
  priceRetrieve: vi.fn(),
  findExisting: vi.fn(),
  resolveDuplicate: vi.fn(),
  checkout: vi.fn(),
  ensurePayToken: vi.fn(),
  sendPayLink: vi.fn(),
  invoice: vi.fn(),
  payments: vi.fn(),
  merch: vi.fn(),
  sendEmail: vi.fn(),
  confirmationEmail: vi.fn(),
  sheetsOn: false,
  createSheet: vi.fn(),
  linkSchool: vi.fn(),
  participation: vi.fn(),
  syncRoster: vi.fn(),
  reconcile: vi.fn(),
  options: vi.fn(),
  autoGrant: vi.fn(),
  provision: vi.fn(),
  followUp: vi.fn(),
  onFile: null as Record<string, unknown> | null,
  afterTasks: [] as Array<{ label: string; task: () => Promise<unknown> }>,
}))

class CheckoutRefused extends Error {}

vi.mock('@/lib/supabase', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return { supabaseServer: () => { h.serviceClient(); return rec.client() } }
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
vi.mock('@/lib/rate-limit-async', () => ({ rateLimit: h.rateLimit }))
vi.mock('@clerk/nextjs/server', () => ({ auth: h.auth }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => h.stripe }))
vi.mock('@/lib/registration-duplicates', () => ({
  findExistingRegistrations: h.findExisting,
  resolveDuplicate: h.resolveDuplicate,
}))
vi.mock('@/lib/registration-checkout', () => ({
  createRegistrationCheckout: h.checkout,
  RegistrationCheckoutError: class extends Error {},
  ensurePayToken: h.ensurePayToken,
  mintPayToken: () => 'minted-token',
  payPageUrl: (slug: string, token: string, o?: { cancelled?: boolean }) =>
    `pay:${slug}:${token}${o?.cancelled ? ':cancelled' : ''}`,
}))
vi.mock('@/lib/registration-pay-link', () => ({ sendPayLinkEmail: h.sendPayLink }))
vi.mock('@/lib/group-invoice', () => ({ createAndSendGroupInvoice: h.invoice }))
vi.mock('@/lib/individual-payment', () => ({ ensureIndividualPayments: h.payments }))
vi.mock('@/lib/store/event-merch', () => ({ finalizeRegistrationMerch: h.merch }))
vi.mock('@/lib/email', () => ({ sendEmail: h.sendEmail, groupConfirmationEmail: h.confirmationEmail }))
vi.mock('@/lib/google-sheets', () => ({
  isGoogleSheetsConfigured: () => h.sheetsOn,
  createGroupRegistrationSheet: h.createSheet,
}))
vi.mock('@/lib/school-link', () => ({ linkMembersToSchoolByName: h.linkSchool }))
vi.mock('@/lib/event-participation-sync', () => ({ recordEventParticipation: h.participation }))
vi.mock('@/lib/space-inheritance', () => ({ syncObjectSpaceRoster: h.syncRoster, reconcileEventSpaceRoster: h.reconcile }))
vi.mock('@/lib/member-profile-options', () => ({ syncMemberOptionSelections: h.options }))
vi.mock('@/lib/auto-membership-grant', () => ({ autoGrantBaseMembership: h.autoGrant }))
vi.mock('@/lib/clerk-provisioning', () => ({ ensureClerkUserAndSignInToken: h.provision }))
vi.mock('@/lib/member-onfile', () => ({ getMemberOnFileByMembershipId: async () => h.onFile }))
vi.mock('@/lib/group-registration-followup', () => ({ runGroupRegistrationFollowUp: h.followUp }))
vi.mock('@/lib/after-response', () => ({
  runAfterResponse: (label: string, task: () => Promise<unknown>) => { h.afterTasks.push({ label, task }) },
}))
vi.mock('@/lib/check-in-codes', () => ({ checkInCodeLink: (slug: string, kind: string, id: string) => `code:${slug}:${kind}:${id}` }))

const { POST } = await import('./route')

type Person = Record<string, unknown>

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
const TEACHER = 'teacher@example.com'
const M = (email: string) => `m-${email}`
const PRICED = { ...OPEN_EVENT, stripePriceId: 'price_x' }
const JOIN_URL = expect.stringMatching(/\/register\/colorado\/join\/[a-f0-9]{64}$/)
const NOTHING_WRITTEN: string[] = []

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
      email: TEACHER, first_name: 'T', last_name: 'Eacher',
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

const post = (b: unknown) => POST(jsonRequest('/api/register/group', b))
const refused = (status: number, error: string, extra: Person = {}) => ({ status, body: { ...extra, error } })
const registrationRow = () => (rec.payloads('insert', 'registrations') as Person[])[0]
const participantRows = () => (rec.payloads('insert', 'participants') as Person[][])[0]
const memberRows = () => (rec.payloads('upsert', 'members') as Person[][])[0]

const withStripe = () => { h.stripe = { prices: { retrieve: h.priceRetrieve } } }

let errors: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  rec.reset()
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  h.afterTasks.length = 0
  h.onFile = null
  h.stripe = null
  h.sheetsOn = false
  h.getEventBySlug.mockResolvedValue(OPEN_EVENT)
  h.getCurrentMember.mockResolvedValue(null)
  h.impersonation.mockResolvedValue(null)
  h.auth.mockResolvedValue({ userId: null })
  h.rateLimit.mockReturnValue(null)
  h.priceRetrieve.mockResolvedValue({ unit_amount: 13500, currency: 'usd' })
  h.findExisting.mockResolvedValue(new Map())
  h.resolveDuplicate.mockReturnValue({ kind: 'none' })
  h.checkout.mockResolvedValue({ url: 'https://checkout.test/cs_1' })
  h.ensurePayToken.mockResolvedValue('ensured-token')
  h.sendPayLink.mockResolvedValue({ sent: true, reason: undefined, recipients: [TEACHER] })
  h.invoice.mockResolvedValue(undefined)
  h.payments.mockResolvedValue(undefined)
  h.merch.mockResolvedValue(undefined)
  h.sendEmail.mockResolvedValue(undefined)
  h.confirmationEmail.mockReturnValue({ subject: 's', html: 'h', text: 't' })
  h.createSheet.mockResolvedValue({ url: 'https://sheet.test/1', spreadsheetId: 'sheet-1' })
  h.linkSchool.mockResolvedValue(undefined)
  h.participation.mockResolvedValue(undefined)
  h.syncRoster.mockResolvedValue(undefined)
  h.reconcile.mockResolvedValue(undefined)
  h.options.mockResolvedValue(undefined)
  h.autoGrant.mockResolvedValue(undefined)
  h.provision.mockResolvedValue({ clerkUserId: 'user_new', signInToken: 'tkt' })
  h.followUp.mockResolvedValue({})
})

afterEach(() => { errors.mockRestore() })

describe('branches: POST /api/register/group — before the event is read', () => {
  it('a body that is not JSON is the catch-all 500, ahead of the rate limit', async () => {
    const res = await POST(new Request('https://www.stellreducation.org/api/register/group', {
      method: 'POST', body: 'not json',
    }) as never)
    expect(await settle(res)).toEqual(refused(500, 'Internal server error'))
    expect(h.rateLimit).not.toHaveBeenCalled()
  })

  it('the rate limit is keyed by the slug, or nothing when the slug is not a string', async () => {
    await post(body())
    expect(h.rateLimit.mock.calls[0].slice(1)).toEqual(['register-group', { limit: 3, windowMs: 3_600_000, tenantId: STELLR_TENANT_ID }, 'colorado'])
    await post(body({ event_slug: 7 }))
    expect(h.rateLimit.mock.calls[1].slice(1)).toEqual(['register-group', { limit: 3, windowMs: 3_600_000, tenantId: STELLR_TENANT_ID }, undefined])
  })

  it('a throttled caller is answered before view-as, the session or any read', async () => {
    h.rateLimit.mockReturnValue(new Response(JSON.stringify({ error: 'slow' }), { status: 429 }))
    expect(await settle(await post(body()))).toEqual(refused(429, 'slow'))
    expect(h.impersonation).not.toHaveBeenCalled()
    expect(h.getCurrentMember).not.toHaveBeenCalled()
    expect(h.getEventBySlug).not.toHaveBeenCalled()
    expect(h.serviceClient).not.toHaveBeenCalled()
  })

  it('a session lookup that throws counts as no session', async () => {
    h.getCurrentMember.mockRejectedValue(new Error('boom'))
    expect((await post(body())).status).toBe(201)
    expect(h.provision).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['no slug', { event_slug: '' }, {}],
    ['no email', {}, { email: '' }],
    ['no first name', {}, { first_name: '' }],
    ['no last name', {}, { last_name: '' }],
    ['no registrant at all', { teacher: null }, {}],
  ])('%s is the missing-fields 400, before the event is read', async (_l, overrides, teacher) => {
    expect(await settle(await post(body(overrides, teacher)))).toEqual(refused(400, 'Missing required fields'))
    expect(h.getEventBySlug).not.toHaveBeenCalled()
    expect(h.serviceClient).not.toHaveBeenCalled()
  })

  it('a signed-in caller with no registrant in the body is still the missing-fields 400', async () => {
    h.getCurrentMember.mockResolvedValue({ email: 'session@example.com' })
    expect(await settle(await post(body({ teacher: null })))).toEqual(refused(400, 'Missing required fields'))
  })

  it('addresses are normalised before anything reads them: the registrant’s, and a school-only participant’s', async () => {
    await post(body(
      { students: [student('1', { email: '', school_email: 'Kid@School.Example.com' }), student('2')] },
      { email: ' Teacher@Example.COM ' },
    ))
    expect(h.findExisting.mock.calls[0][1]).toEqual([TEACHER, 'kid@school.example.com', 's2@example.com'])
    expect(participantRows()[0].email).toBe(TEACHER)
    expect(participantRows()[1]).toMatchObject({ email: 'kid@school.example.com', school_email: 'kid@school.example.com' })
  })
})

describe('branches: POST /api/register/group — the group’s shape', () => {
  const beforeTheDb = async (b: Person, answer: unknown) => {
    expect(await settle(await post(b))).toEqual(answer)
    expect(h.serviceClient).not.toHaveBeenCalled()
    expect(rec.log).toEqual(NOTHING_WRITTEN)
  }

  it('no school, or only spaces, is refused after the event gate', async () => {
    await beforeTheDb(body({}, { school_name: '' }), refused(400, 'Please select or add your school before registering.'))
    await beforeTheDb(body({}, { school_name: '   ' }), refused(400, 'Please select or add your school before registering.'))
    expect(h.getEventBySlug).toHaveBeenCalledTimes(2)
  })

  it('the school comes before the data terms', async () => {
    await beforeTheDb(body({ school_dpa_agreed: false }, { school_name: '' }), refused(400, 'Please select or add your school before registering.'))
  })

  it('terms not accepted is refused', async () => {
    await beforeTheDb(body({ school_dpa_agreed: false }), refused(400, 'Accept the School Data Terms to continue'))
  })

  it('a teacher needs 2 students; a student manager needs 1 other', async () => {
    await beforeTheDb(body({ student_count: 1, total_participants: 2, students: [student('1')] }), refused(400, 'A minimum of 2 students is required'))
    await beforeTheDb(
      body({ registrant_role: 'student_manager', student_count: 0, total_participants: 2, students: [], teacher_poc: { email: 'poc@example.com' } }),
      refused(400, 'A minimum of 2 students is required'),
    )
  })

  it('terms come before the student floor, and the floor before the point of contact', async () => {
    await beforeTheDb(body({ school_dpa_agreed: false, student_count: 0 }), refused(400, 'Accept the School Data Terms to continue'))
    await beforeTheDb(body({ registrant_role: 'student_manager', student_count: 0 }), refused(400, 'A minimum of 2 students is required'))
  })

  it('a student manager with no point of contact is refused, before the count checks', async () => {
    await beforeTheDb(
      body({ registrant_role: 'student_manager', adult_count: -1 }),
      refused(400, 'Student managers must nominate a teacher point of contact'),
    )
  })

  const INVALID_SIZE = 'Group size is invalid. Adult and student counts must be whole numbers between 0 and 200.'
  it.each([
    ['a fractional adult count', { adult_count: 1.5 }],
    ['a fractional student count', { student_count: 2.5 }],
    ['more than the ceiling', { student_count: 201 }],
    ['a count that is a string', { adult_count: '1' }],
    ['a missing student count', { student_count: undefined }],
  ])('%s is the group-size 400', async (_l, overrides) => {
    await beforeTheDb(body(overrides), refused(400, INVALID_SIZE))
  })

  it('exactly the ceiling is a valid size', async () => {
    const res = await settle(await post(body({ student_count: 200, adult_count: 1, total_participants: 201 })))
    expect(res.status).toBe(201)
  })

  it('the arrays are bound to the counts with the exact copy, on add_now only', async () => {
    await beforeTheDb(
      body({ students: [student('1'), student('2'), student('3')] }),
      refused(400, 'You\'ve entered more students (3) than the 2 you declared. Please adjust the group size or remove the extra entries.'),
    )
    await beforeTheDb(
      body({ additional_adults: [student('9')] }),
      refused(400, 'You\'ve entered more additional adults (1) than the 0 your group allows. Please adjust the group size or remove the extra entries.'),
    )
    const res = await post(body({ details_method: 'spreadsheet', students: [student('1'), student('2'), student('3')], additional_adults: [student('9')] }))
    expect(res.status).toBe(201)
  })

  it('a student manager’s adults are all additional', async () => {
    const res = await post(body({
      registrant_role: 'student_manager', teacher_poc: { email: 'poc@example.com' },
      adult_count: 1, student_count: 1, total_participants: 3,
      students: [student('1')], additional_adults: [student('9', { date_of_birth: '1980-01-01' })],
    }))
    expect(res.status).toBe(201)
  })

  it('the total must equal the declared seats, counted after the duplicate checks', async () => {
    const mismatch = (total: number | string, seats: number, adults: number, students: number) =>
      refused(400, `Participant count mismatch: ${total} total does not equal the ${seats} declared (${adults} adult, ${students} student). Please refresh and try again.`)
    expect(await settle(await post(body({ total_participants: 2 })))).toEqual(mismatch(2, 3, 1, 2))
    expect(await settle(await post(body({ total_participants: undefined })))).toEqual(mismatch(0, 3, 1, 2))
    expect(await settle(await post(body({
      registrant_role: 'student_manager', teacher_poc: { email: 'poc@example.com' }, adult_count: 1, total_participants: 3,
    })))).toEqual(mismatch(3, 4, 1, 3))
    expect(h.findExisting).toHaveBeenCalledTimes(3)
    expect(rec.writes()).toEqual(NOTHING_WRITTEN)
  })
})

describe('branches: POST /api/register/group — the rate limit', () => {
  it('a signed-in retry has its own count, under a wider cap per event', async () => {
    h.auth.mockResolvedValue({ userId: 'user_1' })
    await post(body())
    expect(h.rateLimit.mock.calls.map((c) => [c[1], c[2].limit, c[3]])).toEqual([
      ['register-group-session', 30, 'colorado'],
      ['register-group', 3, 'colorado:user_1'],
    ])
  })

  it('new accounts cannot multiply that count: the cap answers first', async () => {
    h.auth.mockResolvedValue({ userId: 'user_1' })
    h.rateLimit.mockReturnValueOnce(new Response(null, { status: 429 }))
    expect((await post(body())).status).toBe(429)
    expect(h.rateLimit).toHaveBeenCalledTimes(1)
  })

  it('a failed session read counts as signed out', async () => {
    h.auth.mockRejectedValue(new Error('clerk down'))
    await post(body())
    expect(h.rateLimit.mock.calls.map((c) => [c[1], c[3]])).toEqual([['register-group', 'colorado']])
  })
})

describe('branches: POST /api/register/group — who is already on this event', () => {
  const existingReg = (type = 'group') => ({ registrationId: 'reg-old', type })
  const match = (kind: string, type = 'group') => h.resolveDuplicate.mockReturnValue({ kind, registration: existingReg(type) })
  const nothingNew = () => expect(rec.writes()).toEqual(NOTHING_WRITTEN)

  it('asks once, for the registrant and everyone entered, on this event', async () => {
    await post(body({ additional_adults: [] }))
    expect(h.findExisting).toHaveBeenCalledTimes(1)
    expect(h.findExisting.mock.calls[0].slice(1)).toEqual([[TEACHER, 's1@example.com', 's2@example.com'], 'colorado'])
  })

  it('with the roster to come, asks for the registrant only', async () => {
    await post(body({ details_method: 'spreadsheet' }))
    expect(h.findExisting.mock.calls[0][1]).toEqual([TEACHER])
  })

  it('the duplicate check is told whether the session is this registrant', async () => {
    const found = [{ registrationId: 'x' }]
    h.findExisting.mockResolvedValue(new Map([[TEACHER, found]]))
    await post(body())
    expect(h.resolveDuplicate).toHaveBeenLastCalledWith(found, { sessionMatches: false })
    h.getCurrentMember.mockResolvedValue({ email: 'Teacher@Example.com' })
    await post(body())
    expect(h.resolveDuplicate).toHaveBeenLastCalledWith(found, { sessionMatches: true })
  })

  describe('nobody signed in as the organiser', () => {
    const ON_FILE = refused(
      409,
      'This email can’t start a new registration for this event. If a payment is unfinished, check the email on file, including spam, for the link to finish it. Otherwise, sign in to see your registration under Account → Teams, or ask your group organiser.',
      { code: 'registration_on_file' },
    )

    beforeEach(() => {
      h.getCurrentMember.mockResolvedValue(null)
    })

    it.each([
      ['already_registered', 'group'],
      ['email_link', 'group'],
      ['email_link', 'individual'],
      ['in_group', 'group'],
      ['invoice_pending', 'group'],
    ])('%s on a %s registration gets the one answer, and nothing new is written', async (kind, type) => {
      match(kind, type)
      expect(await settle(await post(body()))).toEqual(ON_FILE)
      expect(h.checkout).not.toHaveBeenCalled()
      nothingNew()
    })

    it('an unfinished registration of their own has its link sent, with no address in the answer', async () => {
      match('email_link')
      h.sendPayLink.mockResolvedValue({ sent: true, recipients: ['a@example.com', 'b@example.com'] })
      const { body: answer } = await settle(await post(body()))
      expect(JSON.stringify(answer)).not.toContain('@')
      expect(h.afterTasks.map((t) => t.label)).toEqual(['register/group pay-link resend'])
      await h.afterTasks[0].task()
      expect(h.sendPayLink.mock.calls[0][1]).toBe('reg-old')
    })

    it('the answer goes before the email does', async () => {
      match('email_link')
      expect(await settle(await post(body()))).toEqual(ON_FILE)
      expect(h.afterTasks).toHaveLength(1)
      expect(h.sendPayLink).not.toHaveBeenCalled()
    })

    it.each([
      ['already_registered', 'group'],
      ['invoice_pending', 'group'],
      ['in_group', 'group'],
      ['email_link', 'individual'],
    ])('%s on a %s registration sends no email', async (kind, type) => {
      match(kind, type)
      await post(body())
      expect(h.afterTasks).toHaveLength(0)
      expect(h.sendPayLink).not.toHaveBeenCalled()
    })

    it('the answer is the same in every state, with no checkout link and no registration id', async () => {
      const answers = new Set<string>()
      for (const kind of ['already_registered', 'email_link', 'in_group', 'invoice_pending']) {
        match(kind)
        answers.add(JSON.stringify(await settle(await post(body()))))
      }
      expect(answers.size).toBe(1)
      const [only] = answers
      expect(only).not.toContain('reg-old')
      expect(only).not.toContain('checkout')
    })
  })

  describe('signed in as the organiser', () => {
    beforeEach(() => {
      h.getCurrentMember.mockResolvedValue({ email: TEACHER })
    })

  it('an unfinished individual registration is refused, not resumed', async () => {
    match('resume', 'individual')
    withStripe()
    expect(await settle(await post(body()))).toEqual(refused(
      409,
      `${TEACHER} already has an individual registration for this event. Complete its payment from the link in your email, or under Account → Billing.`,
      { code: 'already_registered' },
    ))
    expect(h.checkout).not.toHaveBeenCalled()
    expect(h.sendPayLink).not.toHaveBeenCalled()
    nothingNew()
  })

  it('resume opens a fresh checkout on the earlier registration', async () => {
    match('resume')
    withStripe()
    h.getEventBySlug.mockResolvedValue(PRICED)
    expect(await settle(await post(body()))).toEqual({
      status: 200,
      body: { resume: true, registrationId: 'reg-old', checkoutUrl: 'https://checkout.test/cs_1' },
    })
    expect(h.checkout.mock.calls[0][2]).toBe('reg-old')
    expect(h.checkout.mock.calls[0][3]).toEqual({
      event: PRICED,
      customerEmail: TEACHER,
      successUrl: `${SITE}/register/colorado/confirmation?id=reg-old&type=group&payment=success`,
      cancelUrl: 'pay:colorado:ensured-token:cancelled',
    })
    nothingNew()
  })

  const ALREADY = refused(
    409,
    `${TEACHER} is already registered for this event. If that’s you, sign in to see it under Account → Teams.`,
    { code: 'already_registered' },
  )

  it('resume with Stripe off is the already-registered answer', async () => {
    match('resume')
    expect(await settle(await post(body()))).toEqual(ALREADY)
    nothingNew()
  })

  it('a resume checkout that fails is the already-registered answer, and is logged', async () => {
    match('resume')
    withStripe()
    const boom = new Error('boom')
    h.checkout.mockRejectedValue(boom)
    expect(await settle(await post(body()))).toEqual(ALREADY)
    expect(errors).toHaveBeenCalledWith('[register/group] resume checkout failed:', boom)
    nothingNew()
  })

  it('a refusal from the checkout itself is the same answer, and is not logged as a failure', async () => {
    const { RegistrationCheckoutError } = await import('@/lib/registration-checkout')
    match('resume')
    withStripe()
    h.checkout.mockRejectedValue(new (RegistrationCheckoutError as unknown as new () => Error)())
    expect(await settle(await post(body()))).toEqual(ALREADY)
    expect(errors).not.toHaveBeenCalled()
  })

  it('invoice_pending, in_group and already_registered have their own answers', async () => {
    match('invoice_pending')
    expect(await settle(await post(body()))).toEqual(refused(
      409,
      `An invoice for this group was already sent to ${maskEmail(TEACHER)}. Pay from that email, or reply to it if you need it re-sent.`,
      { code: 'invoice_pending' },
    ))
    match('in_group')
    expect(await settle(await post(body()))).toEqual(refused(
      409,
      `${TEACHER} is already part of a group registration for this event.`,
      { code: 'in_group' },
    ))
    match('already_registered')
    expect(await settle(await post(body()))).toEqual(ALREADY)
    nothingNew()
  })
  })

  it('anyone entered who is already on this event is a conflict, each named once', async () => {
    h.findExisting.mockResolvedValue(new Map([['s1@example.com', [{ registrationId: 'x' }]]]))
    expect(await settle(await post(body({ students: [student('1'), student('1', { first_name: 'Twin' })] })))).toEqual(
      refused(409, 'Already registered for this event: s1@example.com'),
    )
    nothingNew()
  })

  it('a registrant duplicate is answered before a price is looked up', async () => {
    match('already_registered')
    withStripe()
    h.getEventBySlug.mockResolvedValue(PRICED)
    await post(body())
    expect(h.priceRetrieve).not.toHaveBeenCalled()
  })

  it('every date of birth is checked before the duplicate lookup', async () => {
    const res = await post(body({ students: [student('1', { date_of_birth: '' }), student('2')] }))
    expect(res.status).toBe(400)
    expect(h.findExisting).not.toHaveBeenCalled()
  })
})

describe('branches: POST /api/register/group — the price', () => {
  beforeEach(() => {
    withStripe()
    h.getEventBySlug.mockResolvedValue(PRICED)
  })
  const nothingNew = () => expect(rec.writes()).toEqual(NOTHING_WRITTEN)

  it('a card total under the minimum is refused with the amount', async () => {
    h.priceRetrieve.mockResolvedValue({ unit_amount: 10, currency: 'usd' })
    expect(await settle(await post(body({ payment_method: 'card' })))).toEqual(refused(
      400,
      'Card payment isn\'t available for this event: the total ($0.30) is below the $0.50 minimum for card charges. This event\'s price appears to be misconfigured — please contact Stellr or choose the invoice option.',
    ))
    nothingNew()
  })

  it('card with no price, or Stripe off, is refused', async () => {
    const copy = refused(400, 'Card payment is not set up for this event. Please choose the invoice option or contact Stellr.')
    h.getEventBySlug.mockResolvedValue(OPEN_EVENT)
    expect(await settle(await post(body({ payment_method: 'card' })))).toEqual(copy)
    h.getEventBySlug.mockResolvedValue(PRICED)
    h.stripe = null
    expect(await settle(await post(body({ payment_method: 'card' })))).toEqual(copy)
    nothingNew()
  })

  it('an invoice for a positively resolved $0 is refused', async () => {
    h.priceRetrieve.mockResolvedValue({ unit_amount: 0, currency: 'usd' })
    expect(await settle(await post(body({ payment_method: 'invoice' })))).toEqual(refused(
      400,
      'Invoice payment isn\'t available for this event: the total resolved to $0.00. This event\'s price appears to be misconfigured — please contact Stellr.',
    ))
    nothingNew()
  })

  it('an invoice with no price, or Stripe off, is refused', async () => {
    const copy = refused(400, 'This event has no registration fee configured, so no invoice can be issued. Please refresh the page — if the event is meant to be paid, contact Stellr.')
    h.getEventBySlug.mockResolvedValue(OPEN_EVENT)
    expect(await settle(await post(body({ payment_method: 'invoice' })))).toEqual(copy)
    h.getEventBySlug.mockResolvedValue(PRICED)
    h.stripe = null
    expect(await settle(await post(body({ payment_method: 'invoice' })))).toEqual(copy)
    nothingNew()
  })

  it('a resolved price sets the amount and leaves the registration pending', async () => {
    expect((await post(body())).status).toBe(201)
    expect(registrationRow()).toMatchObject({ amount_due_cents: 40500, status: 'pending', pay_token: null, invoice_requested: false })
    expect(h.merch).not.toHaveBeenCalled()
  })

  // A code typed on the form (9 Nov 2026): the first invoice carries it, so the
  // teacher never has to forward an invoice at full price and ask for it again.
  describe('a discount code typed for the invoice', () => {
    const promoList = vi.fn()
    const couponRetrieve = vi.fn()
    beforeEach(() => {
      h.stripe = { prices: { retrieve: h.priceRetrieve }, promotionCodes: { list: promoList }, coupons: { retrieve: couponRetrieve } }
      promoList.mockImplementation(async ({ code }: { code: string }) => ({
        data: code === 'STEMCAREERS' ? [{ code, coupon: 'co_15', active: true, customer: null, expires_at: null, max_redemptions: null, times_redeemed: 0 }] : [],
      }))
      couponRetrieve.mockImplementation(async (id: string) => {
        if (id === 'co_15' || id === 'SCHOLARSHIP100') return { id, valid: true, percent_off: id === 'co_15' ? 15 : 100, amount_off: null, applies_to: null }
        throw new Error('No such coupon')
      })
    })

    it.each([['invoice', {}], ['invoice_some', { registrant_on_invoice: true, late_joiner_payer: 'self' }]])(
      'is saved on a group paying by %s, so its first invoice carries it',
      async (method, extra) => {
        expect((await post(body({ payment_method: method, discount_code: ' STEMCAREERS ', ...extra }))).status).toBe(201)
        expect(registrationRow()).toMatchObject({ invoice_requested: true, invoice_coupon_id: 'co_15', invoice_promotion_code: 'STEMCAREERS' })
        expect(h.invoice).toHaveBeenCalled()
      },
    )

    it('a code that isn’t a promotion code for this event is refused before anything is written', async () => {
      for (const code of ['NOPE', 'SCHOLARSHIP100']) {
        expect(await settle(await post(body({ payment_method: 'invoice', discount_code: code })))).toEqual(refused(
          400,
          'That discount code isn’t valid for this event. Check it, or leave it blank: you can add a code to your invoice later from your account.',
        ))
      }
      nothingNew()
    })

    it('a lookup that fails is a retryable 503, before anything is written', async () => {
      promoList.mockRejectedValue(new Error('stripe down'))
      expect((await post(body({ payment_method: 'invoice', discount_code: 'STEMCAREERS' }))).status).toBe(503)
      nothingNew()
    })

    it('is ignored for a card, which has Stripe’s own code box', async () => {
      expect((await post(body({ payment_method: 'card', discount_code: 'NOPE' }))).status).toBe(201)
      expect(registrationRow()).not.toHaveProperty('invoice_coupon_id')
      expect(promoList).not.toHaveBeenCalled()
    })
  })

  it.each([
    ['an invoice', { payment_method: 'invoice' }],
    ['a card', { payment_method: 'card' }],
    ['members paying individually', { payment_method: 'individual', member_pays_individually: true }],
    ['no way of paying', { payment_method: 'none' }],
  ])('a price that cannot be read refuses %s as a retryable 503, before anything happens', async (_l, overrides) => {
    const boom = new Error('boom')
    h.priceRetrieve.mockRejectedValue(boom)
    expect(await settle(await post(body(overrides)))).toEqual(refused(
      503,
      'Registration is temporarily unavailable. Please try again shortly.',
    ))
    nothingNew()
    expect(h.priceRetrieve).toHaveBeenCalledTimes(1)
    expect(h.provision).not.toHaveBeenCalled()
    expect(h.createSheet).not.toHaveBeenCalled()
    expect(h.invoice).not.toHaveBeenCalled()
    expect(h.checkout).not.toHaveBeenCalled()
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(errors).toHaveBeenCalledWith('[register/group] price lookup failed:', 'colorado', 'price_x', boom)
  })

  it('a free event has no price to read, so a Stripe failure cannot refuse it', async () => {
    h.getEventBySlug.mockResolvedValue(OPEN_EVENT)
    h.priceRetrieve.mockRejectedValue(new Error('boom'))
    expect((await post(body())).status).toBe(201)
    expect(h.priceRetrieve).not.toHaveBeenCalled()
    expect(registrationRow()).toMatchObject({ amount_due_cents: 0, status: 'confirmed' })
  })

  it('a campaign collects nothing, so a price left on its document cannot refuse it', async () => {
    h.getEventBySlug.mockResolvedValue({ ...PRICED, activityType: 'campaign', registrationOpen: true })
    h.priceRetrieve.mockRejectedValue(new Error('boom'))
    expect((await post(body())).status).toBe(201)
    expect(registrationRow()).toMatchObject({ type: 'campaign', status: 'confirmed', amount_due_cents: 0 })
  })

  it('a $0 price is a free event: confirmed, with merch finalised', async () => {
    h.priceRetrieve.mockResolvedValue({ unit_amount: 0, currency: 'usd' })
    expect((await post(body())).status).toBe(201)
    expect(registrationRow()).toMatchObject({ amount_due_cents: 0, status: 'confirmed' })
    expect(h.merch).toHaveBeenCalledWith(expect.anything(), 'reg-1')
  })

  it('a card registration on a priced event carries a minted pay token', async () => {
    await post(body({ payment_method: 'card' }))
    expect(registrationRow()).toMatchObject({ pay_token: 'minted-token', status: 'pending', amount_due_cents: 40500 })
  })

  it('a campaign is confirmed and typed campaign from the document, with no pay token and no merch', async () => {
    h.getEventBySlug.mockResolvedValue({ ...PRICED, activityType: 'campaign', registrationOpen: true })
    await post(body({ payment_method: 'card' }))
    expect(registrationRow()).toMatchObject({ type: 'campaign', status: 'confirmed', pay_token: null })
    expect(h.merch).not.toHaveBeenCalled()
  })

  it('with no title on the document the client’s stands, then an empty one', async () => {
    h.getEventBySlug.mockResolvedValue({ ...OPEN_EVENT, title: undefined })
    h.stripe = null
    await post(body())
    expect(registrationRow().event_title).toBe('Client Title')
    rec.reset()
    await post(body({ event_title: undefined }))
    expect(registrationRow().event_title).toBe('')
  })

  it('the registration row carries the point of contact and the school address', async () => {
    h.getEventBySlug.mockResolvedValue(OPEN_EVENT)
    h.stripe = null
    await post(body(
      { registrant_role: 'student_manager', adult_count: 1, student_count: 2, total_participants: 4, member_pays_individually: true,
        teacher_poc: { first_name: 'Po', last_name: 'C', email: 'poc@example.com' } },
      { school_address_street: '1 Main', school_address_city: 'Denver', school_address_state: 'CO', school_address_zip: '80202' },
    ))
    expect(registrationRow()).toMatchObject({
      registrant_role: 'student_manager', adult_count: 1, student_count: 3,
      teacher_poc_first_name: 'Po', teacher_poc_last_name: 'C', teacher_poc_email: 'poc@example.com',
      member_pays_individually: true, details_method: 'add_now',
      school_address_street: '1 Main', school_address_city: 'Denver', school_address_state: 'CO', school_address_zip: '80202',
    })
  })
})

describe('branches: POST /api/register/group — member rows and their hooks', () => {
  it('a new member’s row: normalised enums, the minor override, and the profile on its canonical columns', async () => {
    await post(body({ students: [
      student('1', {
        school_email: 'S1@School.Example.com', nickname: 'Stu', phone: '555', grade: '9', gender: 'Female', t_shirt_size: 'M',
        health_conditions: 'asthma', emergency_contact_first_name: 'P', emergency_contact_last_name: 'Arent',
        emergency_contact_phone: '556', emergency_contact_relationship: 'Parent',
      }),
      student('2'),
    ] }))
    expect(memberRows()[1]).toEqual({
      email: 's1@example.com', school_email: 's1@school.example.com',
      first_name: 'Stu', last_name: 'Dent1', nickname: 'Stu', phone: '555',
      date_of_birth: '2011-01-01', gender: 'female', grade: 'grade_9', tshirt_size: 'M',
      age_bracket: 'high_school', event_role: 'participant', is_active: true,
      health_conditions: 'asthma',
      ec_first_name: 'P', ec_last_name: 'Arent', ec_email: 'parent1@example.com', ec_phone: '556', ec_relationship: 'Parent',
    })
  })

  it('the registrant’s member row takes the role their form role implies', async () => {
    await post(body({
      registrant_role: 'student_manager', teacher_poc: { email: 'poc@example.com' }, adult_count: 1, total_participants: 4,
    }, { date_of_birth: '2011-01-01' }))
    expect(memberRows()[0]).toMatchObject({ email: TEACHER, event_role: 'school_student_manager', age_bracket: 'high_school' })
  })

  it('each hook gets its arguments, for every member', async () => {
    h.getEventBySlug.mockResolvedValue({ ...OPEN_EVENT, title: 'Server' })
    await post(body({}, { school_address_street: '1 Main', school_address_city: 'Denver', school_address_state: 'CO', school_address_zip: '80202' }))
    const ids = [M(TEACHER), M('s1@example.com'), M('s2@example.com')]
    expect(h.linkSchool.mock.calls[0].slice(1)).toEqual([ids, {
      name: 'Denver High', address_street: '1 Main', address_city: 'Denver', address_state: 'CO', address_zip: '80202',
    }])
    expect(h.participation.mock.calls.map((c) => c[1])).toEqual(ids.map((memberId) => ({
      memberId, eventSlug: 'colorado', eventTitle: 'Server', registrationId: 'reg-1',
    })))
    expect(h.syncRoster.mock.calls.map((c) => c.slice(1))).toEqual(ids.map((id) => ['event', 'colorado', id]))
    expect(h.reconcile.mock.calls[0].slice(1)).toEqual(['colorado'])
    expect(h.autoGrant.mock.calls.map((c) => c[1])).toEqual(ids)
  })

  it('a school address left out reaches the school link as null', async () => {
    await post(body())
    expect(h.linkSchool.mock.calls[0][2]).toEqual({
      name: 'Denver High', address_street: null, address_city: null, address_state: null, address_zip: null,
    })
  })

  it('options are synced only for members this request created', async () => {
    rec.respond((c) => (c.table === 'members' && c.op === 'select' && inFilter(c, 'email', 's1@example.com')
      ? { data: [{ id: 'm-prior', email: 's1@example.com' }], error: null }
      : undefined))
    await post(body({ students: [
      student('1', { ethnicity: ['a'], dietary_requirements: ['b'] }),
      student('2', { ethnicity: ['c'], dietary_requirements: ['d'] }),
    ] }))
    expect(h.options.mock.calls[0][1]).toEqual([
      { memberId: M(TEACHER), ethnicity: undefined, dietary: undefined },
      null,
      { memberId: M('s2@example.com'), ethnicity: ['c'], dietary: ['d'] },
    ])
  })

  it('a failed member insert leaves people unlinked, retries the new registrant alone, and still registers', async () => {
    rec.respond((c) => {
      if (c.table === 'members' && c.op === 'upsert' && Array.isArray(c.payload)) return { data: null, error: { message: 'bad row' } }
      if (c.table === 'members' && c.op === 'upsert') return { data: { id: 'm-solo' }, error: null }
      return undefined
    })
    expect((await post(body())).status).toBe(201)
    expect(rec.writes().slice(0, 3)).toEqual(['insert registrations', 'upsert members', 'upsert members'])
    expect((rec.payloads('upsert', 'members')[1] as Person).email).toBe(TEACHER)
    expect(rec.writes()).toContain('shadow members [m-solo]')
    expect(rec.payloads('update', 'registrations')).toEqual([{ teacher_member_id: 'm-solo' }])
    expect(participantRows().map((r) => r.member_id)).toEqual(['m-solo', null, null])
    expect(h.syncRoster.mock.calls.map((c) => c[3])).toEqual(['m-solo'])
    expect(h.autoGrant.mock.calls.map((c) => c[1])).toEqual(['m-solo'])
  })

  it('a registrant retry that also fails leaves them unlinked, and still registers', async () => {
    rec.respond((c) => (c.table === 'members' && c.op === 'upsert' ? { data: null, error: { message: 'bad row' } } : undefined))
    const res = await settle(await post(body()))
    expect(res.status).toBe(201)
    expect(rec.payloads('update', 'registrations')).toEqual([])
    expect(rec.payloads('update', 'members')).toEqual([])
    expect(res.body).toMatchObject({ signInToken: 'tkt' })
  })

  it('a null member id reaches the school link and event activity, but not the roster or the grant', async () => {
    rec.respond((c) => (c.table === 'members' && c.op === 'upsert'
      ? { data: [{ id: null, email: TEACHER }, { id: 'm-1', email: 's1@example.com' }], error: null }
      : undefined))
    await post(body({ students: [student('1'), student('1', { first_name: 'Twin' })] }))
    expect(h.linkSchool.mock.calls[0][1]).toEqual([null, 'm-1'])
    expect(h.participation.mock.calls.map((c) => c[1].memberId)).toEqual([null, 'm-1'])
    expect(h.syncRoster.mock.calls.map((c) => c[3])).toEqual(['m-1'])
    expect(h.autoGrant.mock.calls.map((c) => c[1])).toEqual(['m-1'])
  })

  it('a registrant whose email a later sibling shares keeps the row; the sibling is unlinked', async () => {
    await post(body({ students: [student('1', { email: TEACHER }), student('2')] }))
    expect(memberRows().map((m) => m.email)).toEqual([TEACHER, 's2@example.com'])
    expect(memberRows()[0].first_name).toBe('T')
    expect(participantRows().map((r) => r.member_id)).toEqual([M(TEACHER), null, M('s2@example.com')])
  })
})

describe('branches: POST /api/register/group — the login', () => {
  it('asks with the name, whether the member is new, and today’s age input', async () => {
    await post(body())
    expect(h.provision).toHaveBeenCalledWith(TEACHER, 'T', 'Eacher', {
      memberIsNew: true, age: { dateOfBirth: '1980-01-01' },
    })
  })

  it('a registrant already on file is asked for as not new', async () => {
    rec.respond((c) => (c.table === 'members' && c.op === 'select' && inFilter(c, 'email', TEACHER)
      ? { data: [{ id: 'm-prior', email: TEACHER }], error: null }
      : undefined))
    await post(body())
    expect(h.provision.mock.calls[0][3]).toMatchObject({ memberIsNew: false })
  })

  it('runs after the member hooks and before participants are written', async () => {
    h.provision.mockImplementation(async () => {
      expect(h.options).toHaveBeenCalled()
      expect(rec.payloads('update', 'registrations')).toHaveLength(1)
      expect(rec.payloads('insert', 'participants')).toHaveLength(0)
      return { clerkUserId: 'user_new', signInToken: 'tkt' }
    })
    expect(await settle(await post(body()))).toMatchObject({ status: 201, body: { signInToken: 'tkt' } })
  })

  it('no token minted: no Clerk id is written', async () => {
    h.provision.mockResolvedValue({ clerkUserId: 'user_old', signInToken: null })
    expect(await settle(await post(body()))).toMatchObject({ body: { signInToken: null } })
    expect(rec.payloads('update', 'members')).toEqual([])
  })

  it('a Clerk failure is logged and the registration still completes', async () => {
    const boom = new Error('boom')
    h.provision.mockRejectedValue(boom)
    expect(await settle(await post(body()))).toMatchObject({ status: 201, body: { signInToken: null } })
    expect(errors).toHaveBeenCalledWith('Clerk provisioning (non-fatal):', boom)
    expect(rec.writes()).toContain('insert participants')
  })
})

describe('branches: POST /api/register/group — participant rows', () => {
  it('a typed row in full: the raw values, its own role by age, and null for what was left out', async () => {
    await post(body({ students: [
      student('1', {
        school_email: 'S1@School.Example.com', nickname: 'Stu', phone: '555', grade: '9', gender: 'Female', t_shirt_size: 'M',
        ethnicity: ['eth'], dietary_requirements: ['veg'], health_conditions: 'asthma',
        emergency_contact_first_name: 'P', emergency_contact_last_name: 'Arent',
        emergency_contact_phone: '556', emergency_contact_relationship: 'Parent',
      }),
      student('2'),
    ] }))
    expect(participantRows()[1]).toEqual({
      registration_id: 'reg-1', member_id: M('s1@example.com'), details_from_member: false,
      tenant_id: STELLR_TENANT_ID, // S5 A7: from the resolved event
      first_name: 'Stu', last_name: 'Dent1', nickname: 'Stu',
      email: 's1@example.com', school_email: 's1@school.example.com', phone: '555',
      date_of_birth: '2011-01-01', grade: '9', gender: 'Female', ethnicity: ['eth'], t_shirt_size: 'M',
      school_name: 'Denver High', age_bracket: 'college', event_role: 'participant',
      dietary_requirements: ['veg'], health_conditions: 'asthma',
      emergency_contact_first_name: 'P', emergency_contact_last_name: 'Arent',
      emergency_contact_email: 'parent1@example.com', emergency_contact_phone: '556',
      emergency_contact_relationship: 'Parent', individual_payment_status: null, payer: null,
    })
    expect(participantRows()[2]).toMatchObject({
      nickname: null, school_email: null, grade: null, ethnicity: [], dietary_requirements: [], health_conditions: null,
      emergency_contact_first_name: null,
    })
  })

  it('the registrant’s row takes the teacher’s details and never their school address', async () => {
    await post(body({}, {
      nickname: 'Tee', phone: '555', gender: 'Male', t_shirt_size: 'L', grade: '12', school_email: 'never@school.example.com',
      ethnicity: ['e'], dietary_requirements: ['d'], health_conditions: 'h',
      emergency_contact_first_name: 'A', emergency_contact_last_name: 'B', emergency_contact_email: 'c@example.com',
      emergency_contact_phone: '556', emergency_contact_relationship: 'Spouse',
    }))
    expect(participantRows()[0]).toEqual({
      registration_id: 'reg-1', member_id: M(TEACHER), details_from_member: false,
      tenant_id: STELLR_TENANT_ID, // S5 A7: from the resolved event
      first_name: 'T', last_name: 'Eacher', nickname: 'Tee',
      email: TEACHER, school_email: null, phone: '555',
      date_of_birth: '1980-01-01', grade: '12', gender: 'Male', ethnicity: ['e'], t_shirt_size: 'L',
      school_name: 'Denver High', age_bracket: 'adult', event_role: 'teacher',
      dietary_requirements: ['d'], health_conditions: 'h',
      emergency_contact_first_name: 'A', emergency_contact_last_name: 'B', emergency_contact_email: 'c@example.com',
      emergency_contact_phone: '556', emergency_contact_relationship: 'Spouse', individual_payment_status: null, payer: null,
    })
  })

  it('adults come before students', async () => {
    await post(body({ adult_count: 2, total_participants: 4, additional_adults: [student('9', { date_of_birth: '1980-01-01' })] }))
    expect(participantRows().map((r) => r.email)).toEqual([TEACHER, 's9@example.com', 's1@example.com', 's2@example.com'])
  })

  it('members paying individually are pending on a priced event, on every row, and with the roster to come', async () => {
    withStripe()
    h.getEventBySlug.mockResolvedValue(PRICED)
    await post(body({ member_pays_individually: true }))
    expect(participantRows().map((r) => r.individual_payment_status)).toEqual(['pending', 'pending', 'pending'])
    rec.reset()
    await post(body({ member_pays_individually: true, details_method: 'spreadsheet' }))
    expect(participantRows().map((r) => r.individual_payment_status)).toEqual(['pending'])
  })

  it('members paying individually are waived on a free event, or with Stripe off', async () => {
    await post(body({ member_pays_individually: true }))
    expect(participantRows().map((r) => r.individual_payment_status)).toEqual(['waived', 'waived', 'waived'])
  })

  it('returned rows pair back by position; a short return is logged and those people get no follow-up', async () => {
    rec.respond((c) => (c.table === 'participants' && c.op === 'insert'
      ? { data: [{ id: 'p-a', email: TEACHER }, { id: 'p-b', email: 's1@example.com' }], error: null }
      : undefined))
    await post(body({ member_pays_individually: true }))
    expect(errors).toHaveBeenCalledWith('[register/group] inserted participant count mismatch', { inserted: 2, expected: 3 })
    expect(rec.writes()).toContain('shadow participants [p-a,p-b]')
    await h.afterTasks[0].task()
    const { people } = h.followUp.mock.calls[0][1]
    expect(people.map((p: { agreement: { participantId: string } }) => p.agreement.participantId)).toEqual(['p-a', 'p-b'])
    expect(h.payments.mock.calls[0][2].map((p: { participantId: string }) => p.participantId)).toEqual(['p-a', 'p-b'])
  })

  it('the follow-up carries the school state, and its deadline is the budget from the start of the request', async () => {
    const before = Date.now()
    await post(body({}, { school_address_state: 'CO' }))
    const after = Date.now()
    expect(h.afterTasks.map((t) => t.label)).toEqual(['register/group'])
    expect(h.followUp).not.toHaveBeenCalled()
    await h.afterTasks[0].task()
    const input = h.followUp.mock.calls[0][1]
    expect(input.deadline).toBeGreaterThanOrEqual(before + 250_000)
    expect(input.deadline).toBeLessThanOrEqual(after + 250_000)
    expect(input.people[0].agreement.schoolState).toBe('CO')
  })

  it('the follow-up is scheduled before the sheet is made', async () => {
    h.sheetsOn = true
    h.createSheet.mockImplementation(async () => {
      expect(h.afterTasks).toHaveLength(1)
      return { url: 'https://sheet.test/1', spreadsheetId: 'sheet-1' }
    })
    expect((await post(body())).status).toBe(201)
    expect(h.createSheet).toHaveBeenCalledTimes(1)
  })
})

describe('branches: POST /api/register/group — the sheet', () => {
  beforeEach(() => { h.sheetsOn = true })

  it('with everyone entered: seeded, no blank rows left, stored, and not offered as an action', async () => {
    const res = await settle(await post(body({ students: [
      student('1', { phone: '555', gender: 'Female', t_shirt_size: 'M', grade: '9', dietary_requirements: ['v'], health_conditions: 'h', school_email: 'K@School.Example.com',
        emergency_contact_first_name: 'P', emergency_contact_last_name: 'A', emergency_contact_phone: '556', emergency_contact_relationship: 'Parent' }),
      student('2'),
    ] })))
    const input = h.createSheet.mock.calls[0][0]
    expect(input).toMatchObject({
      eventTitle: 'Colorado', schoolName: 'Denver High', teacherEmail: TEACHER,
      additionalAdultCount: 0, studentCount: 0,
    })
    expect(input.enteredParticipants).toHaveLength(2)
    expect(input.enteredParticipants[0]).toEqual({
      type: 'Student', first_name: 'Stu', last_name: 'Dent1', email: 's1@example.com', phone: '555',
      date_of_birth: '2011-01-01', gender: 'Female', t_shirt_size: 'M', grade: '9',
      dietary_requirements: ['v'], health_conditions: 'h',
      ec_first_name: 'P', ec_last_name: 'A', ec_email: 'parent1@example.com', ec_phone: '556', ec_relationship: 'Parent',
      school_email: 'k@school.example.com',
    })
    expect(res.body).toMatchObject({ spreadsheetUrl: null })
    const update = rec.calls.find((c) => c.table === 'registrations' && c.op === 'update' && (c.payload as Person).spreadsheet_id)
    expect(update?.payload).toEqual({ spreadsheet_id: 'sheet-1' })
    expect(update?.filters).toEqual([['eq', 'id', 'reg-1']])
  })

  it('an additional adult is typed Teacher only by that exact role', async () => {
    await post(body({
      adult_count: 3, total_participants: 5,
      additional_adults: [
        student('8', { date_of_birth: '1980-01-01', event_role: 'Teacher' }),
        student('9', { date_of_birth: '1980-01-01', event_role: 'mentor' }),
      ],
    }))
    expect(h.createSheet.mock.calls[0][0].enteredParticipants.map((p: Person) => p.type)).toEqual(['Teacher', 'Adult', 'Student', 'Student'])
  })

  it('a partial add_now leaves blank rows for the rest and offers the sheet', async () => {
    const res = await settle(await post(body({ adult_count: 2, student_count: 3, total_participants: 5, students: [student('1')] })))
    expect(h.createSheet.mock.calls[0][0]).toMatchObject({ additionalAdultCount: 1, studentCount: 2 })
    expect(res.body).toMatchObject({ spreadsheetUrl: 'https://sheet.test/1' })
    expect(h.confirmationEmail.mock.calls[0][0]).toMatchObject({ remainingCount: 3 })
  })

  it('a student manager’s adults all count as additional', async () => {
    await post(body({
      registrant_role: 'student_manager', teacher_poc: { email: 'poc@example.com' }, adult_count: 1, student_count: 2, total_participants: 4,
    }))
    expect(h.createSheet.mock.calls[0][0]).toMatchObject({ additionalAdultCount: 1, studentCount: 0 })
    expect(h.confirmationEmail.mock.calls[0][0]).toMatchObject({ remainingCount: 1 })
  })

  it('with the roster to come: nothing seeded, every row blank, and offered', async () => {
    const res = await settle(await post(body({ details_method: 'spreadsheet', students: [student('1')] })))
    expect(h.createSheet.mock.calls[0][0]).toMatchObject({ additionalAdultCount: 0, studentCount: 2, enteredParticipants: [] })
    expect(res.body).toMatchObject({ spreadsheetUrl: 'https://sheet.test/1' })
    expect(h.confirmationEmail.mock.calls[0][0]).toMatchObject({ remainingCount: 0 })
  })

  it('a sheet failure is logged, and the registration completes with no link', async () => {
    const boom = new Error('boom')
    h.createSheet.mockRejectedValue(boom)
    const res = await settle(await post(body({ details_method: 'spreadsheet' })))
    expect(res).toMatchObject({ status: 201, body: { spreadsheetUrl: null } })
    expect(errors).toHaveBeenCalledWith('Google Sheets error (non-fatal):', boom)
    expect(h.confirmationEmail.mock.calls[0][0].spreadsheetUrl).toBeUndefined()
  })

  it('with sheets not configured nothing is attempted', async () => {
    h.sheetsOn = false
    await post(body())
    expect(h.createSheet).not.toHaveBeenCalled()
  })
})

describe('branches: POST /api/register/group — the join link', () => {
  it('is written for 30 days against this registration and returned', async () => {
    const before = Date.now()
    const res = await settle(await post(body()))
    const [row] = rec.payloads('insert', 'group_join_tokens') as Person[]
    expect(row).toEqual({
      token: expect.stringMatching(/^[a-f0-9]{64}$/),
      registration_id: 'reg-1', event_slug: 'colorado', event_title: 'Colorado',
      expires_at: expect.any(String),
    })
    const ms = new Date(row.expires_at as string).getTime()
    expect(ms - before).toBeGreaterThanOrEqual(30 * 86_400_000)
    expect(ms - before).toBeLessThan(30 * 86_400_000 + 60_000)
    expect((res.body as { joinUrl: string }).joinUrl).toBe(`${SITE}/register/colorado/join/${row.token}`)
  })

  it('a failed insert is logged and there is simply no link', async () => {
    rec.respond((c) => (c.table === 'group_join_tokens' ? { data: null, error: { message: 'boom' } } : undefined))
    const res = await settle(await post(body()))
    expect(res).toMatchObject({ status: 201, body: { joinUrl: null } })
    expect(errors).toHaveBeenCalledWith('Group join token insert error (non-fatal):', { message: 'boom' })
  })
})

describe('branches: POST /api/register/group — the invoice', () => {
  beforeEach(() => {
    withStripe()
    h.getEventBySlug.mockResolvedValue(PRICED)
  })
  const invoiced = () => body({ payment_method: 'invoice' })

  it('reads the event a second time, and sends the amount already resolved', async () => {
    expect((await post(invoiced())).status).toBe(201)
    expect(h.getEventBySlug).toHaveBeenCalledTimes(2)
    expect(h.priceRetrieve).toHaveBeenCalledTimes(2)
    expect(h.invoice.mock.calls[0][2]).toEqual({
      registrationId: 'reg-1', eventSlug: 'colorado', eventTitle: 'Colorado',
      teacher: { email: TEACHER, firstName: 'T', lastName: 'Eacher' },
      registrantMemberId: M(TEACHER),
      amountCents: 40500, perSeatCents: 13500, currency: 'usd', totalParticipants: 3,
    })
    expect(registrationRow().invoice_requested).toBe(true)
  })

  it('with no price on the second read, sends nothing', async () => {
    h.getEventBySlug.mockResolvedValueOnce(PRICED).mockResolvedValueOnce(OPEN_EVENT)
    expect((await post(invoiced())).status).toBe(201)
    expect(h.invoice).not.toHaveBeenCalled()
  })

  it('a first read that fails is refused, even if a second read would have worked', async () => {
    h.priceRetrieve.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ unit_amount: 100, currency: 'cad' })
    expect((await post(invoiced())).status).toBe(503)
    expect(rec.writes()).toEqual(NOTHING_WRITTEN)
    expect(h.invoice).not.toHaveBeenCalled()
  })

  it('a second read that fails sends no invoice, keeps the amount, and the registration completes', async () => {
    const boom = new Error('boom')
    h.priceRetrieve.mockResolvedValueOnce({ unit_amount: 13500, currency: 'usd' }).mockRejectedValueOnce(boom)
    expect((await post(invoiced())).status).toBe(201)
    expect(registrationRow()).toMatchObject({ amount_due_cents: 40500, status: 'pending', invoice_requested: true })
    expect(h.invoice).not.toHaveBeenCalled()
    expect(errors).toHaveBeenCalledWith('Stripe invoice error (non-fatal):', boom)
  })

  it('a registrant with no member id is invoiced with null', async () => {
    rec.respond((c) => (c.table === 'members' && c.op === 'upsert' ? { data: null, error: { message: 'x' } } : undefined))
    await post(invoiced())
    expect(h.invoice.mock.calls[0][2].registrantMemberId).toBeNull()
  })

  it('an invoice failure is logged, and the registration completes', async () => {
    const boom = new Error('boom')
    h.invoice.mockRejectedValue(boom)
    expect((await post(invoiced())).status).toBe(201)
    expect(errors).toHaveBeenCalledWith('Stripe invoice error (non-fatal):', boom)
    expect(h.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('members paying individually with an invoice chosen get the invoice, not their own links', async () => {
    await post(body({ payment_method: 'invoice', member_pays_individually: true }))
    expect(h.invoice).toHaveBeenCalledTimes(1)
    expect(h.payments).not.toHaveBeenCalled()
  })
})

describe('branches: POST /api/register/group — the card', () => {
  beforeEach(() => {
    withStripe()
    h.getEventBySlug.mockResolvedValue(PRICED)
  })
  const carded = (o: Person = {}) => body({ payment_method: 'card', ...o })

  it('a complete add_now: the checkout gets the first read of the event and a plain return URL', async () => {
    h.getEventBySlug.mockResolvedValueOnce(PRICED).mockResolvedValueOnce({ ...PRICED, title: 'Second read' })
    const res = await settle(await post(carded()))
    expect(res).toEqual({
      status: 201,
      body: { registrationId: 'reg-1', checkoutUrl: 'https://checkout.test/cs_1', spreadsheetUrl: null, joinUrl: JOIN_URL, signInToken: 'tkt' },
    })
    expect(h.checkout.mock.calls[0][2]).toBe('reg-1')
    expect(h.checkout.mock.calls[0][3]).toEqual({
      event: PRICED,
      customerEmail: TEACHER,
      successUrl: `${SITE}/register/colorado/confirmation?id=reg-1&type=group&payment=success`,
      cancelUrl: 'pay:colorado:minted-token:cancelled',
    })
    expect(h.ensurePayToken).not.toHaveBeenCalled()
  })

  it('a partial add_now carries the sheet, the join link and what remains', async () => {
    h.sheetsOn = true
    const res = await settle(await post(carded({ students: [student('1')] })))
    const url = new URL(h.checkout.mock.calls[0][3].successUrl)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      id: 'reg-1', type: 'group', payment: 'success',
      spreadsheet: 'https://sheet.test/1',
      join: (res.body as { joinUrl: string }).joinUrl,
      remaining: '1',
    })
  })

  it('with the roster to come it carries the sheet, but no join link and no count', async () => {
    h.sheetsOn = true
    await post(carded({ details_method: 'spreadsheet' }))
    const url = new URL(h.checkout.mock.calls[0][3].successUrl)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      id: 'reg-1', type: 'group', payment: 'success', spreadsheet: 'https://sheet.test/1',
    })
  })

  it('a campaign has no minted token, so the cancel link ensures one', async () => {
    h.getEventBySlug.mockResolvedValue({ ...PRICED, activityType: 'campaign', registrationOpen: true })
    await post(carded())
    expect(h.ensurePayToken.mock.calls[0][1]).toBe('reg-1')
    expect(h.checkout.mock.calls[0][3].cancelUrl).toBe('pay:colorado:ensured-token:cancelled')
    expect(h.confirmationEmail.mock.calls[0][0].payUrl).toBeUndefined()
    expect(rec.payloads('update', 'registrations').some((p) => 'pay_link_sent_at' in (p as Person))).toBe(false)
  })

  it('a Stripe failure is the 502 in Stripe’s words, with the registration kept and nothing further done', async () => {
    h.checkout.mockRejectedValue(new Stripe.errors.StripeInvalidRequestError({ message: 'wrong mode', type: 'invalid_request_error' } as never))
    expect(await settle(await post(carded()))).toEqual({
      status: 502,
      body: { error: 'Payment could not be started: wrong mode', registrationId: 'reg-1' },
    })
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(rec.writes()).not.toContain('delete registrations')
    expect(rec.writes()).toContain('insert group_join_tokens')
  })

  it('any other failure is the 502 that says the registration was saved', async () => {
    h.checkout.mockRejectedValue(new CheckoutRefused('nope'))
    expect(await settle(await post(carded()))).toEqual({
      status: 502,
      body: { error: 'Payment could not be started. Your registration was saved — please contact Stellr to complete payment.', registrationId: 'reg-1' },
    })
  })

  it('with no price on the second read and members not paying, there is no checkout and no error', async () => {
    h.getEventBySlug.mockResolvedValueOnce(PRICED).mockResolvedValueOnce(OPEN_EVENT)
    expect(await settle(await post(carded()))).toMatchObject({ status: 201, body: { checkoutUrl: null } })
    expect(h.checkout).not.toHaveBeenCalled()
    expect(h.confirmationEmail.mock.calls[0][0].payUrl).toBeUndefined()
  })
})

describe('branches: POST /api/register/group — members paying individually', () => {
  it('everyone entered gets their own link, the registrant included', async () => {
    await post(body({ member_pays_individually: true }))
    expect(h.payments.mock.calls[0].slice(1)).toEqual(['reg-1', [
      { participantId: 'p-0', email: TEACHER, firstName: 'T', lastName: 'Eacher' },
      { participantId: 'p-1', email: 's1@example.com', firstName: 'Stu', lastName: 'Dent1' },
      { participantId: 'p-2', email: 's2@example.com', firstName: 'Stu', lastName: 'Dent2' },
    ]])
  })

  it('with the roster to come, the registrant alone', async () => {
    await post(body({ member_pays_individually: true, details_method: 'spreadsheet' }))
    expect(h.payments.mock.calls[0][2].map((p: { email: string }) => p.email)).toEqual([TEACHER])
  })

  it('comes before merch, and merch before the email', async () => {
    const order: string[] = []
    h.payments.mockImplementation(async () => { order.push('payments') })
    h.merch.mockImplementation(async () => { order.push('merch') })
    h.sendEmail.mockImplementation(async () => { order.push('email') })
    await post(body({ member_pays_individually: true }))
    expect(order).toEqual(['payments', 'merch', 'email'])
  })

  it('a thrown payment step is the catch-all 500, with the rows kept', async () => {
    h.payments.mockRejectedValue(new Error('boom'))
    expect(await settle(await post(body({ member_pays_individually: true })))).toEqual(refused(500, 'Internal server error'))
    expect(rec.writes()).not.toContain('delete registrations')
  })
})

describe('branches: POST /api/register/group — the confirmation email', () => {
  it('gets everything it shows, in one call, to the registrant', async () => {
    h.sheetsOn = true
    await post(body({ details_method: 'spreadsheet' }))
    expect(h.confirmationEmail).toHaveBeenCalledWith({
      teacherFirstName: 'T', teacherLastName: 'Eacher', schoolName: 'Denver High',
      eventTitle: 'Colorado', participantCount: 3, registrationId: 'reg-1',
      paymentMethod: 'none', detailsMethod: 'spreadsheet',
      spreadsheetUrl: 'https://sheet.test/1', joinUrl: JOIN_URL,
      remainingCount: 0, payUrl: undefined,
      checkInCodeUrl: 'code:colorado:g:reg-1',
    })
    expect(h.sendEmail).toHaveBeenCalledWith({ to: TEACHER, cc: [], subject: 's', html: 'h', text: 't' })
  })

  it('a complete add_now still carries the sheet in the email', async () => {
    h.sheetsOn = true
    await post(body())
    expect(h.confirmationEmail.mock.calls[0][0]).toMatchObject({ spreadsheetUrl: 'https://sheet.test/1', remainingCount: 0 })
  })

  it('copies the point of contact', async () => {
    await post(body({
      registrant_role: 'student_manager', teacher_poc: { email: 'poc@example.com' }, adult_count: 1, total_participants: 4,
    }))
    expect(h.sendEmail.mock.calls[0][0].cc).toEqual(['poc@example.com'])
  })

  it('a card registration carries the pay link, and the send stamps the cooldown', async () => {
    withStripe()
    h.getEventBySlug.mockResolvedValue(PRICED)
    await post(body({ payment_method: 'card' }))
    expect(h.confirmationEmail.mock.calls[0][0].payUrl).toBe('pay:colorado:minted-token')
    const stamp = rec.calls.find((c) => c.op === 'update' && c.table === 'registrations' && 'pay_link_sent_at' in (c.payload as Person))
    expect(stamp?.filters).toEqual([['eq', 'id', 'reg-1']])
    expect(rec.writes().at(-1)).toBe('update registrations')
  })

  it('a failed send is logged, the cooldown is not stamped, and the answer is still the 201', async () => {
    withStripe()
    h.getEventBySlug.mockResolvedValue(PRICED)
    const boom = new Error('boom')
    h.sendEmail.mockRejectedValue(boom)
    expect(await settle(await post(body({ payment_method: 'card' })))).toMatchObject({ status: 201 })
    expect(errors).toHaveBeenCalledWith('Confirmation email failed (non-fatal):', boom)
    expect(rec.payloads('update', 'registrations').some((p) => 'pay_link_sent_at' in (p as Person))).toBe(false)
  })
})

// The gate covers persist: a participant row is only ever written for someone the
// age check passed, carrying the date the check returned. Today's check is
// checkRegistrationAge. A7 adds the tenant-age assertion at the same point.
describe('branches: POST /api/register/group — the gate covers every row written', () => {
  const WITH_TIME = '2011-01-01T12:00:00Z'

  it('every row has the date the check returned, whichever slot it came from', async () => {
    await post(body(
      { adult_count: 2, total_participants: 4, additional_adults: [student('9', { date_of_birth: ' 1985-04-01T00:00:00Z ' })],
        students: [student('1', { date_of_birth: WITH_TIME }), student('2', { date_of_birth: WITH_TIME })] },
      { date_of_birth: '1980-01-01T00:00:00Z' },
    ))
    expect(participantRows().map((r) => r.date_of_birth)).toEqual(['1980-01-01', '1985-04-01', '2011-01-01', '2011-01-01'])
    expect(memberRows().map((m) => m.date_of_birth)).toEqual(['1980-01-01', '1985-04-01', '2011-01-01', '2011-01-01'])
  })

  it.each([
    ['the registrant', {}, { date_of_birth: '' }],
    ['an additional adult', { adult_count: 2, total_participants: 4, additional_adults: [student('9', { date_of_birth: 'abc' })] }, {}],
    ['the last student', { students: [student('1'), student('2', { date_of_birth: 'abc' })] }, {}],
  ])('a refusal for %s comes before any write or outside effect', async (_l, overrides, teacher) => {
    expect((await post(body(overrides, teacher))).status).toBe(400)
    expect(rec.log).toEqual(NOTHING_WRITTEN)
    expect(h.provision).not.toHaveBeenCalled()
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(h.createSheet).not.toHaveBeenCalled()
    expect(h.priceRetrieve).not.toHaveBeenCalled()
  })

  it('people in the body are not written when the roster comes later, so nothing unchecked reaches a row', async () => {
    await post(body({ details_method: 'spreadsheet', students: [student('1', { date_of_birth: 'abc' })], additional_adults: [student('9', { date_of_birth: 'abc' })] }))
    expect(participantRows().map((r) => r.email)).toEqual([TEACHER])
    expect(memberRows().map((m) => m.email)).toEqual([TEACHER])
  })

  // What a refusal from the database at this step leaves behind, as it stands:
  // A7 has to refuse before the first write, because this cannot be taken back.
  it('a participant insert refused by the database takes back only the registration', async () => {
    rec.respond((c) => (c.table === 'participants' && c.op === 'insert' ? { data: null, error: { code: '23514', message: 'refused' } } : undefined))
    expect(await settle(await post(body()))).toEqual(refused(500, 'Failed to save participant details'))
    expect(rec.writes()).toEqual([
      'insert registrations',
      'upsert members',
      `shadow members [${[TEACHER, 's1@example.com', 's2@example.com'].map(M).join(',')}]`,
      'update registrations',
      'update members',
      'insert participants',
      'delete registrations',
    ])
    expect(h.linkSchool).toHaveBeenCalledTimes(1)
    expect(h.participation).toHaveBeenCalledTimes(3)
    expect(h.autoGrant).toHaveBeenCalledTimes(3)
    expect(h.provision).toHaveBeenCalledTimes(1)
    expect(h.afterTasks).toHaveLength(0)
    expect(h.sendEmail).not.toHaveBeenCalled()
  })
})

// Added after the split, from its reviews: each of these failed to notice a deliberate
// change to the code it covers, so a later edit could have changed them unseen. They
// pin what the route already did, and they make no change to it.
describe('branches: POST /api/register/group — pinned after the split', () => {
  const upsertOptions = () => rec.calls.filter((c) => c.op === 'upsert' && c.table === 'members').map((c) => c.options)
  const KEEP_EXISTING_ROW = { onConflict: 'email', ignoreDuplicates: true }

  it('the member insert never overwrites a row that already exists', async () => {
    await post(body())
    expect(upsertOptions()).toEqual([KEEP_EXISTING_ROW])
  })

  it('nor does the retry for the registrant alone', async () => {
    rec.respond((c) => (c.table === 'members' && c.op === 'upsert' && Array.isArray(c.payload)
      ? { data: null, error: { message: 'bad row' } }
      : undefined))
    await post(body())
    expect(upsertOptions()).toEqual([KEEP_EXISTING_ROW, KEEP_EXISTING_ROW])
  })

  describe('a Member ID slot among the additional adults', () => {
    const ON_FILE = {
      memberId: 'm-linked', first_name: 'Stored', last_name: 'Latest', member_last_name: 'Ked', email: 'linked@example.com',
      date_of_birth: '1985-04-01', ethnicity: [], dietary_requirements: [],
    }
    const withLinkedAdult = () => body({
      adult_count: 2, total_participants: 4,
      additional_adults: [{ linked: true, existing_membership_id: 'STL-1', first_name: 'Typed', last_name: 'Ked' }],
    })

    it('writes the participant from the record, reusing the member', async () => {
      h.onFile = ON_FILE
      expect((await post(withLinkedAdult())).status).toBe(201)
      expect(participantRows()[1]).toMatchObject({
        member_id: 'm-linked', details_from_member: true, email: 'linked@example.com', first_name: 'Stored', last_name: 'Latest', date_of_birth: '1985-04-01',
      })
      expect(memberRows().map((m) => m.email)).toEqual([TEACHER, 's1@example.com', 's2@example.com'])
    })

    it('its sheet row carries the name it was submitted with', async () => {
      h.onFile = ON_FILE
      h.sheetsOn = true
      await post(withLinkedAdult())
      const [adult] = h.createSheet.mock.calls[0][0].enteredParticipants as Person[]
      expect(adult).toMatchObject({ first_name: 'Typed', last_name: 'Ked' })
      expect(JSON.stringify(adult)).not.toContain('linked@example.com')
      expect(JSON.stringify(adult)).not.toContain('1985-04-01')
    })
  })

  it('a body with no role, no details method and no pay-individually flag gets the defaults', async () => {
    expect((await post(body({ registrant_role: undefined, details_method: undefined, member_pays_individually: undefined }))).status).toBe(201)
    expect(registrationRow()).toMatchObject({ registrant_role: 'teacher', details_method: 'add_now', member_pays_individually: false })
    expect(participantRows().map((r) => r.email)).toEqual([TEACHER, 's1@example.com', 's2@example.com'])
  })

  it('a free campaign is confirmed with no merch finalised, unlike a free event', async () => {
    h.getEventBySlug.mockResolvedValue({ ...OPEN_EVENT, activityType: 'campaign', registrationOpen: true })
    expect((await post(body())).status).toBe(201)
    expect(registrationRow()).toMatchObject({ type: 'campaign', status: 'confirmed', amount_due_cents: 0 })
    expect(h.merch).not.toHaveBeenCalled()
  })

  it('a bad address is answered before a bad date of birth', async () => {
    expect(await settle(await post(body({
      students: [student('1', { email: 'not-an-address', date_of_birth: 'abc' }), student('2')],
    })))).toEqual(refused(400, 'The email for Stu Dent1 doesn\'t look right. Please check it and try again.'))
  })

  // Pinned as it stands, not endorsed: a Stripe price with no unit amount (tiered, for
  // one) resolves to $0, so the event reads as free and the registration is confirmed.
  it('a price with no unit amount reads as free, not as unresolved', async () => {
    withStripe()
    h.getEventBySlug.mockResolvedValue(PRICED)
    h.priceRetrieve.mockResolvedValue({ unit_amount: null, currency: 'usd' })
    expect((await post(body())).status).toBe(201)
    expect(registrationRow()).toMatchObject({ amount_due_cents: 0, status: 'confirmed' })
    expect(h.merch).toHaveBeenCalledWith(expect.anything(), 'reg-1')
  })
})

// "Invoice for some" (9 Nov 2026): the registrant on the invoice, the others by link.
describe('branches: POST /api/register/group — invoice for some', () => {
  beforeEach(() => {
    withStripe()
    h.getEventBySlug.mockResolvedValue(PRICED)
  })

  it('invoices only the ticked places and sends links to everyone else', async () => {
    const res = await post(body({ payment_method: 'invoice_some', registrant_on_invoice: true, late_joiner_payer: 'self' }))
    expect(res.status).toBe(201)
    expect(h.invoice.mock.calls[0][2]).toMatchObject({ amountCents: 13500, perSeatCents: 13500, totalParticipants: 1 })
    expect(registrationRow()).toMatchObject({ invoice_requested: true, member_pays_individually: false, late_joiner_payer: 'self', amount_due_cents: 13500 })
    expect(h.payments).toHaveBeenCalledTimes(1)
  })

  it('refuses when nobody would be on the invoice, before anything is written', async () => {
    const res = await post(body({ payment_method: 'invoice_some', registrant_on_invoice: false, late_joiner_payer: 'self' }))
    expect(res.status).toBe(400)
    expect(rec.writes()).toEqual(NOTHING_WRITTEN)
  })

  it('refuses a payment method the form never offers', async () => {
    const res = await post(body({ payment_method: 'cheque' }))
    expect(res.status).toBe(400)
    expect(rec.writes()).toEqual(NOTHING_WRITTEN)
  })
})

// "Students share the teacher's cost" (9 Nov 2026).
describe('branches: POST /api/register/group — students share the teacher’s cost', () => {
  beforeEach(() => {
    withStripe()
    h.getEventBySlug.mockResolvedValue(PRICED)
  })

  it('covers the teacher, sends the students links, and records the estimate and price', async () => {
    const res = await post(body({ payment_method: 'teacher_share', share_estimate: 2 }))
    expect(res.status).toBe(201)
    expect(registrationRow()).toMatchObject({ member_pays_individually: true, invoice_requested: false, share_estimate: 2, share_unit_cents: 13500 })
    const [registrant, ...others] = participantRows()
    expect(registrant).toMatchObject({ payer: 'shared', individual_payment_status: 'covered' })
    expect(others.every((p) => p.payer === 'self' && p.individual_payment_status === 'pending')).toBe(true)
    expect(h.invoice).not.toHaveBeenCalled()
    expect(h.payments).toHaveBeenCalledTimes(1)
  })

  it('refuses a missing or silly estimate, before anything is written', async () => {
    expect((await post(body({ payment_method: 'teacher_share' }))).status).toBe(400)
    expect((await post(body({ payment_method: 'teacher_share', share_estimate: 0 }))).status).toBe(400)
    expect(rec.writes()).toEqual(NOTHING_WRITTEN)
  })
})
