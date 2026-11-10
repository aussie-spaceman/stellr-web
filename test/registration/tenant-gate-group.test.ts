import { describe, it, expect, vi, beforeEach } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { rec, TODAY, dateBefore, jsonRequest, settle, type DbCall, type DbResult } from '@/test/registration/fixtures'

// S5 A7: POST /api/register/group on a tenant's event. The route, the gate, the
// roster checks, lib/registration/eligibility and lib/registration/event-context
// are real; the database is the recording fake, and everything with an outside
// effect is a spy. Stellr's own answers are pinned, unchanged, by the
// characterisation and branch suites beside the route.

const CANARY = 'c0000000-0000-4000-8000-0000000000aa'

const h = vi.hoisted(() => ({
  requestTenant: vi.fn(async (): Promise<{ kind: string; tenantId: string; tenantSlug: string }> => ({
    kind: 'stellr', tenantId: '00000000-0000-4000-8000-000000000001', tenantSlug: 'stellr',
  })),
  getEventBySlug: vi.fn(async (_slug: string): Promise<unknown> => null),
  onFile: vi.fn(async (_db: unknown, _id: string): Promise<unknown> => null),
  findExisting: vi.fn(async (_db: unknown, _emails: string[], _slug: string) => new Map()),
  resolveDuplicate: vi.fn((_rows: unknown, _o: unknown): { kind: string; registration?: unknown } => ({ kind: 'none' })),
  checkout: vi.fn(async () => ({ url: 'https://checkout.test/cs_1' })),
  invoice: vi.fn(async () => {}),
  priceRetrieve: vi.fn(async () => ({ unit_amount: 2500, currency: 'usd' })),
  tenantConfirmation: vi.fn(async (_db: unknown, _input: Record<string, unknown>) => ({ ok: true, id: 'em_1' })),
  stellrEmail: vi.fn(async () => {}),
  followUp: vi.fn(async () => ({})),
  provision: vi.fn(async () => ({ signInToken: 'tkt', clerkUserId: 'user_1' })),
  hook: vi.fn((_name: string) => {}),
  session: null as { email: string } | null,
}))

vi.mock('@/lib/tenancy/request-tenant', () => ({ requestTenant: h.requestTenant }))
vi.mock('@/lib/supabase', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return { supabaseServer: () => rec.client() }
})
vi.mock('@/lib/field-crypto-shadow', () => ({ shadowSyncFields: () => {} }))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: h.getEventBySlug }))
vi.mock('@/lib/community', () => ({ getCurrentMember: async () => h.session }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => ({ prices: { retrieve: h.priceRetrieve } }) }))
vi.mock('@/lib/registration-duplicates', () => ({
  findExistingRegistrations: h.findExisting,
  resolveDuplicate: h.resolveDuplicate,
}))
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: null }) }))
vi.mock('@/lib/clerk-provisioning', () => ({ ensureClerkUserAndSignInToken: h.provision }))
vi.mock('@/lib/rate-limit-async', () => ({ rateLimit: async () => null }))
vi.mock('@/lib/after-response', () => ({ runAfterResponse: (label: string) => h.hook(`after ${label}`) }))
vi.mock('@/lib/group-registration-followup', () => ({ runGroupRegistrationFollowUp: h.followUp }))
vi.mock('@/lib/email', () => ({
  sendEmail: h.stellrEmail,
  groupConfirmationEmail: () => ({ subject: '', html: '', text: '' }),
}))
vi.mock('@/lib/event-emails/tenant-mail', () => ({ sendTenantConfirmation: h.tenantConfirmation }))
vi.mock('@/lib/individual-payment', () => ({ ensureIndividualPayments: async () => h.hook('ensureIndividualPayments') }))
vi.mock('@/lib/store/event-merch', () => ({ finalizeRegistrationMerch: async () => h.hook('finalizeRegistrationMerch') }))
vi.mock('@/lib/google-sheets', () => ({
  isGoogleSheetsConfigured: () => true,
  createGroupRegistrationSheet: async () => { h.hook('createGroupRegistrationSheet'); return { url: 'https://docs.test', spreadsheetId: 's1' } },
}))
vi.mock('@/lib/school-link', () => ({
  linkMembersToSchoolByName: async () => h.hook('linkMembersToSchoolByName'),
  linkMembersToRegistrationSchool: async () => h.hook('linkMembersToRegistrationSchool'),
  resolveAndLinkSchool: async () => { h.hook('resolveAndLinkSchool'); return null },
}))
vi.mock('@/lib/event-participation-sync', () => ({ recordEventParticipation: async () => h.hook('recordEventParticipation') }))
vi.mock('@/lib/space-inheritance', () => ({
  syncObjectSpaceRoster: async () => h.hook('syncObjectSpaceRoster'),
  reconcileEventSpaceRoster: async () => h.hook('reconcileEventSpaceRoster'),
}))
vi.mock('@/lib/member-profile-options', () => ({ syncMemberOptionSelections: async () => h.hook('syncMemberOptionSelections') }))
vi.mock('@/lib/auto-membership-grant', () => ({ autoGrantBaseMembership: async () => h.hook('autoGrantBaseMembership') }))
vi.mock('@/lib/member-onfile', () => ({ getMemberOnFileByMembershipId: h.onFile }))
vi.mock('@/lib/registration-pay-link', () => ({ sendPayLinkEmail: async () => h.hook('sendPayLinkEmail') }))
vi.mock('@/lib/group-invoice', () => ({ createAndSendGroupInvoice: h.invoice }))
vi.mock('@/lib/registration-checkout', () => ({
  createRegistrationCheckout: h.checkout,
  RegistrationCheckoutError: class extends Error {},
  ensurePayToken: async () => 'paytok',
  mintPayToken: () => 'paytok',
  payPageUrl: () => 'https://www.stellreducation.org/pay',
}))

const { POST } = await import('@/app/api/register/group/route')

type Person = Record<string, unknown>

/** The event in the CMS, held today. */
const EVENT = { title: 'Canary Cup', activityType: 'live_event', date: TODAY }
/** Its mirror row: owned by the Canary tenant, starting today in Denver. */
const MIRROR = {
  tenant_id: CANARY,
  activity_type: 'live_event',
  starts_at: `${TODAY}T12:00:00Z` as string | null,
  time_zone: 'America/Denver',
  min_participant_age: null as number | null,
}
const TENANT = { id: CANARY, is_platform_owner: false, min_participant_age: 14 }

const DOB_13 = dateBefore(13)
const DOB_14 = dateBefore(14)
// Students default to 18 on the event date: nobody under 18 registers for a tenant's
// event until tenants can collect a guardian's consent (assertRegistrable).
const DOB_18 = dateBefore(18)

const student = (n: string, overrides: Person = {}): Person => ({
  email: `s${n}@example.com`, first_name: 'Stu', last_name: `Dent${n}`,
  date_of_birth: DOB_18, phone: '', gender: '', t_shirt_size: '',
  age_bracket: 'high_school', event_role: 'participant',
  emergency_contact_email: `parent${n}@example.com`,
  ...overrides,
})

function body(overrides: Person = {}): Person {
  return {
    event_slug: 'canary-cup',
    registrant_role: 'teacher',
    teacher: {
      email: 'teacher@example.com', first_name: 'T', last_name: 'Eacher',
      school_name: 'Sydney High', date_of_birth: '1980-01-01',
      phone: '', gender: '', t_shirt_size: '', age_bracket: 'adult',
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

function onHost(tenantId: string) {
  h.requestTenant.mockResolvedValue(
    tenantId === STELLR_TENANT_ID
      ? { kind: 'stellr', tenantId, tenantSlug: 'stellr' }
      : { kind: 'tenant', tenantId, tenantSlug: 'canary' },
  )
}

function mirror(row: Partial<typeof MIRROR> | null, opts: { eventsError?: boolean } = {}) {
  rec.respond((c: DbCall): DbResult | undefined => {
    if (c.table === 'events' && c.op === 'select') {
      return opts.eventsError ? { data: null, error: { message: 'down' } } : { data: row ? { ...MIRROR, ...row } : null, error: null }
    }
    if (c.table === 'tenants' && c.op === 'select') return { data: TENANT, error: null }
    return undefined
  })
}

const writes = () => rec.calls.filter((c) => c.op !== 'select')
const UNUSABLE = (name: string) => ({
  status: 400,
  body: {
    code: 'dob_missing',
    error: `We couldn't use the Stellr Member ID for ${name}. Check the ID and last name, or enter their details by hand. If both are right, ask them to check their date of birth with Stellr.`,
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  rec.reset()
  h.getEventBySlug.mockResolvedValue(EVENT)
  h.onFile.mockResolvedValue(null)
  h.findExisting.mockResolvedValue(new Map())
  h.resolveDuplicate.mockReturnValue({ kind: 'none' })
  h.session = null
  onHost(CANARY)
  mirror({})
})

describe('S5 A7: register/group on a tenant event, the age gate', () => {
  it('a 13-year-old student is refused at the API, with nothing written', async () => {
    const res = await settle(await post(body({ students: [student('1'), student('2', { date_of_birth: DOB_13 })] })))
    expect(res).toEqual({ status: 400, body: { code: 'under_minimum_age', error: 'Stu Dent2 must be 14 or older on the day of the event to take part.' } })
    expect(writes()).toEqual([])
    expect(h.findExisting).not.toHaveBeenCalled()
  })

  it('a 13-year-old registrant is refused the same way', async () => {
    const res = await settle(await post(body({ teacher: { ...(body().teacher as Person), date_of_birth: DOB_13 } })))
    expect(res).toMatchObject({ status: 400, body: { code: 'under_minimum_age' } })
    expect(writes()).toEqual([])
  })

  it.each([
    ['missing', '', 'dob_missing'],
    ['in the future', '2999-01-01', 'dob_invalid'],
    ['over 120', '1890-01-01', 'dob_invalid'],
  ])('an unknown date of birth (%s) is refused, with nothing written', async (_l, dob, code) => {
    const res = await settle(await post(body({ students: [student('1', { date_of_birth: dob }), student('2')] })))
    expect(res).toMatchObject({ status: 400, body: { code } })
    expect(writes()).toEqual([])
  })

  it('a minimum on the event raises the floor, and one below the tenant minimum cannot lower it', async () => {
    mirror({ min_participant_age: 16 })
    const raised = await settle(await post(body({ students: [student('1', { date_of_birth: DOB_14 }), student('2')] })))
    expect(raised.body).toEqual({ code: 'under_minimum_age', error: 'Stu Dent1 must be 16 or older on the day of the event to take part.' })
    rec.reset()
    mirror({ min_participant_age: 10 })
    const low = await settle(await post(body({ students: [student('1', { date_of_birth: DOB_13 }), student('2')] })))
    expect(low.body).toMatchObject({ code: 'under_minimum_age' })
    expect(writes()).toEqual([])
  })

  it('a live tenant event with no start date refuses everyone (owner decision open), with nothing written', async () => {
    mirror({ starts_at: null })
    const res = await settle(await post(body()))
    expect(res.status).toBe(503)
    expect(res.body).toMatchObject({ code: 'eligibility_unavailable' })
    expect(writes()).toEqual([])
  })

  it('a 14- or 17-year-old student is refused until tenants can collect a guardian’s consent, with nothing written', async () => {
    for (const years of [14, 17]) {
      const res = await settle(await post(body({ students: [student('1'), student('2', { date_of_birth: dateBefore(years) })] })))
      expect(res).toEqual({
        status: 400,
        body: { code: 'under_minimum_age', error: 'Stu Dent2 must be 18 or older to register for this event online. Please contact the event organiser.' },
      })
    }
    expect(writes()).toEqual([])
    expect(h.findExisting).not.toHaveBeenCalled()
    expect(h.tenantConfirmation).not.toHaveBeenCalled()
  })

  it('adults on the event date are admitted: every row carries the tenant, and only those rows are written', async () => {
    const res = await settle(await post(body()))
    expect(res).toEqual({
      status: 201,
      body: { registrationId: 'reg-1', checkoutUrl: null, spreadsheetUrl: null, joinUrl: null, signInToken: null },
    })
    const tables = writes().map((c) => `${c.op} ${c.table}`)
    expect(tables).toEqual(['insert registrations', 'insert participants'])
    const [reg] = rec.payloads('insert', 'registrations') as Person[]
    expect(reg.tenant_id).toBe(CANARY)
    const [rows] = rec.payloads('insert', 'participants') as Person[][]
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(row).toMatchObject({ tenant_id: CANARY, member_id: null })
    expect(h.hook).not.toHaveBeenCalled()
    expect(h.provision).not.toHaveBeenCalled()
    expect(h.followUp).not.toHaveBeenCalled()
    expect(h.stellrEmail).not.toHaveBeenCalled()
    expect(h.tenantConfirmation).toHaveBeenCalledTimes(1)
    expect(h.tenantConfirmation.mock.calls[0][1]).toMatchObject({ tenantId: CANARY, to: 'teacher@example.com' })
  })
})

describe('S5 A7: register/group on a tenant event, Member IDs', () => {
  const slot = { linked: true, existing_membership_id: 'STL-1', first_name: 'Sub', last_name: 'Mitted' }

  it('a Member ID slot is unusable, with the unknown ID’s answer, and no record is looked up (cross-tenant)', async () => {
    h.onFile.mockResolvedValue({
      memberId: 'm-stellr', first_name: 'Real', last_name: 'Mitted', member_last_name: 'Mitted',
      email: 'stellr-member@example.com', date_of_birth: DOB_14, ethnicity: [], dietary_requirements: [],
    })
    const tenantAnswer = await settle(await post(body({ students: [student('1'), slot] })))
    expect(h.onFile).not.toHaveBeenCalled()
    expect(tenantAnswer).toEqual(UNUSABLE('Sub Mitted'))
    expect(JSON.stringify(tenantAnswer)).not.toContain('stellr-member')
    expect(writes()).toEqual([])

    // The same slot, naming no record at all, on Stellr's own event: the same answer.
    rec.reset()
    onHost(STELLR_TENANT_ID)
    mirror(null)
    h.onFile.mockResolvedValue(null)
    expect(await settle(await post(body({ students: [student('1'), slot] })))).toEqual(tenantAnswer)
  })

  it('a Member ID record under the tenant minimum gets the same answer as an unknown ID', async () => {
    h.onFile.mockResolvedValue({
      memberId: 'm-young', first_name: 'Sub', last_name: 'Mitted', member_last_name: 'Mitted',
      email: 'young@example.com', date_of_birth: DOB_13, ethnicity: [], dietary_requirements: [],
    })
    const young = await settle(await post(body({ students: [student('1'), slot] })))
    rec.reset()
    mirror({})
    h.onFile.mockResolvedValue(null)
    const unknown = await settle(await post(body({ students: [student('1'), slot] })))
    expect(young).toEqual(unknown)
    expect(young).toEqual(UNUSABLE('Sub Mitted'))
    expect(writes()).toEqual([])
  })
})

describe('S5 A7: register/group, priced tenant events fail closed', () => {
  const PENDING_CARD = { kind: 'resume', registration: { registrationId: 'reg-old', type: 'group', status: 'pending' } }

  it('a priced tenant event with an unpaid card registration on file: refused before the duplicate answer, and no Checkout', async () => {
    h.getEventBySlug.mockResolvedValue({ ...EVENT, stripePriceId: 'price_1' })
    h.findExisting.mockResolvedValue(new Map([['teacher@example.com', [{ registrationId: 'reg-old' }]]]))
    h.resolveDuplicate.mockReturnValue(PENDING_CARD)
    const res = await settle(await post(body({ payment_method: 'card' })))
    expect(res).toMatchObject({ status: 503, body: { code: 'tenant_payments_unavailable' } })
    expect(h.findExisting).not.toHaveBeenCalled()
    expect(h.checkout).not.toHaveBeenCalled()
    expect(h.invoice).not.toHaveBeenCalled()
    expect(h.priceRetrieve).not.toHaveBeenCalled()
    expect(writes()).toEqual([])
  })

  it.each([
    ['a price on the event', { stripePriceId: 'price_1' }, {}],
    ['card on a free event', {}, { payment_method: 'card' }],
    ['invoice on a free event', {}, { payment_method: 'invoice' }],
    // #584's ways to pay: an invoice for some, and seats sharing the teacher's cost.
    ['invoice for some on a free event', {}, { payment_method: 'invoice_some', registrant_on_invoice: true }],
    ['sharing the teacher’s cost on a free event', {}, { payment_method: 'teacher_share', member_pays_individually: true, share_estimate: 10 }],
    ['sharing the teacher’s cost on a priced event', { stripePriceId: 'price_1' }, { payment_method: 'teacher_share', member_pays_individually: true, share_estimate: 10 }],
    // What GroupRegistrationForm sends when the organiser picks "each member pays".
    ['seats paid one by one on a priced event', { stripePriceId: 'price_1' }, { payment_method: 'individual', member_pays_individually: true }],
  ])('%s is refused, with nothing written', async (_l, event, extra) => {
    h.getEventBySlug.mockResolvedValue({ ...EVENT, ...event })
    h.findExisting.mockResolvedValue(new Map([['teacher@example.com', [{ registrationId: 'reg-old' }]]]))
    h.resolveDuplicate.mockReturnValue(PENDING_CARD)
    const res = await settle(await post(body(extra)))
    expect(res).toMatchObject({ status: 503, body: { code: 'tenant_payments_unavailable' } })
    expect(writes()).toEqual([])
    expect(h.findExisting).not.toHaveBeenCalled()
    expect(h.checkout).not.toHaveBeenCalled()
    expect(h.invoice).not.toHaveBeenCalled()
  })

  it('a free tenant event, sent exactly as the group form sends it, is admitted with nothing to pay', async () => {
    // GroupRegistrationForm on a free, non-campaign event: payment_method 'none',
    // is_campaign false, and member_pays_individually true (isFree settles every
    // seat individually, at nothing owed).
    const formPayload = body({
      event_title: 'Canary Cup',
      teacher_poc: null,
      payment_method: 'none',
      is_campaign: false,
      member_pays_individually: true,
    })
    const res = await settle(await post(formPayload))
    expect(res).toEqual({
      status: 201,
      body: { registrationId: 'reg-1', checkoutUrl: null, spreadsheetUrl: null, joinUrl: null, signInToken: null },
    })
    expect(writes().map((c) => `${c.op} ${c.table}`)).toEqual(['insert registrations', 'insert participants'])
    const [reg] = rec.payloads('insert', 'registrations') as Person[]
    expect(reg.tenant_id).toBe(CANARY)
    expect(h.checkout).not.toHaveBeenCalled()
    expect(h.invoice).not.toHaveBeenCalled()
    expect(h.priceRetrieve).not.toHaveBeenCalled()
    expect(h.hook).not.toHaveBeenCalled()
  })

  it('a free tenant event, the organiser signed in with an unpaid registration on file: no Checkout is opened', async () => {
    h.session = { email: 'teacher@example.com' }
    h.findExisting.mockResolvedValue(new Map([['teacher@example.com', [{ registrationId: 'reg-old' }]]]))
    h.resolveDuplicate.mockReturnValue(PENDING_CARD)
    const res = await settle(await post(body()))
    expect(res.status).toBe(409)
    expect(h.checkout).not.toHaveBeenCalled()
    expect(writes()).toEqual([])
  })

  it('a free tenant event, someone else naming an unfinished registration: no pay link is resent', async () => {
    h.findExisting.mockResolvedValue(new Map([['teacher@example.com', [{ registrationId: 'reg-old' }]]]))
    h.resolveDuplicate.mockReturnValue({ kind: 'email_link', registration: { registrationId: 'reg-old', type: 'group' } })
    const res = await settle(await post(body()))
    expect(res).toMatchObject({ status: 409, body: { code: 'registration_on_file' } })
    expect(h.hook).not.toHaveBeenCalled()
    expect(writes()).toEqual([])
  })
})

describe('S5 A7: register/group, whose event', () => {
  it('Stellr’s event named on a tenant host is not found, with nothing written', async () => {
    mirror(null)
    expect(await settle(await post(body()))).toEqual({ status: 404, body: { error: 'Event not found' } })
    expect(writes()).toEqual([])
  })

  it('a tenant’s event named on Stellr’s host is not found, with nothing written', async () => {
    onHost(STELLR_TENANT_ID)
    expect(await settle(await post(body()))).toEqual({ status: 404, body: { error: 'Event not found' } })
    expect(writes()).toEqual([])
    expect(h.findExisting).not.toHaveBeenCalled()
  })

  it('another tenant’s event named on a tenant host is not found', async () => {
    mirror({ tenant_id: 'd0000000-0000-4000-8000-0000000000bb' })
    expect(await settle(await post(body()))).toEqual({ status: 404, body: { error: 'Event not found' } })
    expect(writes()).toEqual([])
  })

  it('a failed owner read refuses, retryably, and is never taken as Stellr', async () => {
    onHost(STELLR_TENANT_ID)
    mirror(null, { eventsError: true })
    const res = await settle(await post(body()))
    expect(res.status).toBe(503)
    expect(writes()).toEqual([])
  })
})
