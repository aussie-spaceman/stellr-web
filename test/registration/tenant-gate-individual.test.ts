import { describe, it, expect, vi, beforeEach } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { AGE_CASES, rec, TODAY, dateBefore, jsonRequest, settle, type DbCall, type DbResult } from '@/test/registration/fixtures'

// S5 A7: POST /api/register/individual, on a tenant's event and, for the traces
// the slice asks for, on Stellr's. The route, the gate, lib/registration/eligibility
// and lib/registration/event-context are real; the database is the recording fake,
// and everything with an outside effect is a spy.

const CANARY = 'c0000000-0000-4000-8000-0000000000aa'

const h = vi.hoisted(() => ({
  requestTenant: vi.fn(async (): Promise<{ kind: string; tenantId: string; tenantSlug: string }> => ({
    kind: 'stellr', tenantId: '00000000-0000-4000-8000-000000000001', tenantSlug: 'stellr',
  })),
  getEventBySlug: vi.fn(async (_slug: string): Promise<unknown> => null),
  findOffer: vi.fn(async (): Promise<unknown> => null),
  findExisting: vi.fn(async () => new Map()),
  checkout: vi.fn(async () => ({ url: 'https://checkout.test/cs_1' })),
  priceRetrieve: vi.fn(async () => ({ unit_amount: 2500 })),
  tenantConfirmation: vi.fn(async (_db: unknown, _input: Record<string, unknown>) => ({ ok: true, id: 'em_1' })),
  dispatch: vi.fn(async (_db: unknown, _a: Record<string, unknown>) => {}),
  provision: vi.fn(async () => ({ signInToken: 'tkt', clerkUserId: 'user_1' })),
  hook: vi.fn((_name: string) => {}),
  audit: vi.fn(async (_m: Record<string, unknown>, _o?: unknown) => ({ ok: false, skipped: 'disabled' })),
}))

vi.mock('@/lib/tenancy/request-tenant', () => ({ requestTenant: h.requestTenant }))
vi.mock('@/lib/audit/route', () => ({ auditMutation: h.audit }))
vi.mock('@/lib/supabase', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return { supabaseServer: () => rec.client() }
})
vi.mock('@/lib/field-crypto-shadow', () => ({ shadowSyncFields: () => {} }))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: h.getEventBySlug }))
vi.mock('@/lib/community', () => ({ getCurrentMember: async () => null }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/pending-consent', async (orig) => ({
  ...(await orig<typeof import('@/lib/pending-consent')>()),
  sessionChildAwaitingConsentBlock: async () => null,
}))
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: null }) }))
vi.mock('@/lib/clerk-provisioning', () => ({ ensureClerkUserAndSignInToken: h.provision }))
vi.mock('@/lib/rate-limit-async', () => ({ rateLimit: async () => null }))
vi.mock('@/lib/scholarships', () => ({ findOfferByToken: h.findOffer, attachOfferToRegistration: async () => h.hook('attachOffer') }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => ({ prices: { retrieve: h.priceRetrieve } }) }))
vi.mock('@/lib/registration-duplicates', () => ({
  findExistingRegistrations: h.findExisting,
  resolveDuplicate: () => ({ kind: 'none' }),
}))
vi.mock('@/lib/docusign-agreements', () => ({ dispatchAgreement: h.dispatch }))
vi.mock('@/lib/school-link', () => ({
  resolveAndLinkSchool: async () => { h.hook('resolveAndLinkSchool'); return { state: 'CO' } },
  linkMembersToSchoolByName: async () => h.hook('linkMembersToSchoolByName'),
  linkMembersToRegistrationSchool: async () => h.hook('linkMembersToRegistrationSchool'),
}))
vi.mock('@/lib/member-profile-options', () => ({ syncMemberOptionSelections: async () => h.hook('syncMemberOptionSelections') }))
vi.mock('@/lib/event-participation-sync', () => ({ recordEventParticipation: async () => h.hook('recordEventParticipation') }))
vi.mock('@/lib/auto-membership-grant', () => ({ autoGrantBaseMembership: async () => h.hook('autoGrantBaseMembership') }))
vi.mock('@/lib/space-inheritance', () => ({
  syncObjectSpaceRoster: async () => h.hook('syncObjectSpaceRoster'),
  reconcileEventSpaceRoster: async () => h.hook('reconcileEventSpaceRoster'),
}))
vi.mock('@/lib/store/event-merch', () => ({
  prepareRegistrationAddons: async () => { h.hook('prepareRegistrationAddons'); return [] },
  addRegistrationAddons: async () => h.hook('addRegistrationAddons'),
}))
vi.mock('@/lib/registration-confirm', () => ({ confirmRegistration: async () => h.hook('confirmRegistration') }))
vi.mock('@/lib/registration-pay-link', () => ({ sendPayLinkEmail: async () => { h.hook('sendPayLinkEmail'); return { sent: false } } }))
vi.mock('@/lib/event-emails/tenant-mail', () => ({ sendTenantConfirmation: h.tenantConfirmation }))
vi.mock('@/lib/registration-checkout', () => ({
  createRegistrationCheckout: h.checkout,
  RegistrationCheckoutError: class extends Error {},
  ensurePayToken: async () => 'paytok',
  mintPayToken: () => 'paytok',
  payPageUrl: () => 'https://www.stellreducation.org/pay',
  pendingAddonLines: async () => [],
}))

const { POST } = await import('@/app/api/register/individual/route')

type Person = Record<string, unknown>

const EVENT = { title: 'Canary Cup', activityType: 'live_event', date: TODAY }
const MIRROR = {
  tenant_id: CANARY,
  activity_type: 'live_event',
  starts_at: `${TODAY}T12:00:00Z` as string | null,
  time_zone: 'America/Denver',
  min_participant_age: null as number | null,
}
const TENANT = { id: CANARY, is_platform_owner: false, min_participant_age: 14 }

function post(overrides: Person = {}) {
  return POST(jsonRequest('/api/register/individual', {
    event_slug: 'canary-cup',
    email: 'kid@example.com', first_name: 'K', last_name: 'Id',
    // An adult: nobody under 18 registers for a tenant's event until tenants can
    // collect a guardian's consent (assertRegistrable).
    phone: '555', date_of_birth: dateBefore(18), school_name: 'Sydney High',
    grade: '9', gender: 'female', t_shirt_size: 'M',
    event_role: 'participant', age_bracket: 'high_school',
    emergency_contact_first_name: 'P', emergency_contact_last_name: 'Id',
    emergency_contact_email: 'parent@example.com', emergency_contact_phone: '556',
    emergency_contact_relationship: 'Parent',
    ...overrides,
  }))
}

function onHost(tenantId: string) {
  h.requestTenant.mockResolvedValue(
    tenantId === STELLR_TENANT_ID
      ? { kind: 'stellr', tenantId, tenantSlug: 'stellr' }
      : { kind: 'tenant', tenantId, tenantSlug: 'canary' },
  )
}

function mirror(row: Partial<typeof MIRROR> | null) {
  rec.respond((c: DbCall): DbResult | undefined => {
    if (c.table === 'events' && c.op === 'select') return { data: row ? { ...MIRROR, ...row } : null, error: null }
    if (c.table === 'tenants' && c.op === 'select') return { data: TENANT, error: null }
    return undefined
  })
}

const writes = () => rec.calls.filter((c) => c.op !== 'select')

beforeEach(() => {
  vi.clearAllMocks()
  rec.reset()
  h.getEventBySlug.mockResolvedValue(EVENT)
  h.findOffer.mockResolvedValue(null)
  onHost(CANARY)
  mirror({})
})

describe('S5 A7: register/individual on a tenant event', () => {
  it('a 13-year-old is refused at the API, with nothing written', async () => {
    const res = await settle(await post({ date_of_birth: dateBefore(13) }))
    expect(res).toEqual({ status: 400, body: { code: 'under_minimum_age', error: 'You must be 14 or older on the day of the event to take part.' } })
    expect(writes()).toEqual([])
    expect(h.findExisting).not.toHaveBeenCalled()
  })

  it('a 12-year-old, under 13 today, is refused whatever the event date', async () => {
    mirror({ starts_at: `${dateBefore(-3)}T12:00:00Z` })
    h.getEventBySlug.mockResolvedValue({ ...EVENT, date: dateBefore(-3) })
    const res = await settle(await post({ date_of_birth: dateBefore(13, -1) }))
    expect(res).toMatchObject({ status: 400, body: { code: 'under_minimum_age' } })
    expect(writes()).toEqual([])
  })

  it.each([
    ['missing', '', 'dob_missing'],
    ['not a date', 'soon', 'dob_invalid'],
    ['in the future', '2999-01-01', 'dob_invalid'],
  ])('an unknown date of birth (%s) is refused, with nothing written', async (_l, dob, code) => {
    expect(await settle(await post({ date_of_birth: dob }))).toMatchObject({ status: 400, body: { code } })
    expect(writes()).toEqual([])
  })

  it('a 14- or 17-year-old is refused until tenants can collect a guardian’s consent, with nothing written', async () => {
    for (const years of [14, 17]) {
      expect(await settle(await post({ date_of_birth: dateBefore(years) }))).toEqual({
        status: 400,
        body: { code: 'under_minimum_age', error: 'You must be 18 or older to register for this event online. Please contact the event organiser.' },
      })
    }
    expect(writes()).toEqual([])
    expect(h.findExisting).not.toHaveBeenCalled()
    expect(h.tenantConfirmation).not.toHaveBeenCalled()
  })

  it('an adult is admitted: the rows carry the tenant, no member row, no Stellr hooks, the tenant’s confirmation', async () => {
    const res = await settle(await post())
    expect(res).toEqual({ status: 201, body: { registrationId: 'reg-1', checkoutUrl: null, signInToken: null } })
    expect(writes().map((c) => `${c.op} ${c.table}`)).toEqual(['insert registrations', 'insert participants'])
    expect(rec.calls.some((c) => c.table === 'members')).toBe(false)
    expect((rec.payloads('insert', 'registrations')[0] as Person).tenant_id).toBe(CANARY)
    expect(rec.payloads('insert', 'participants')[0]).toMatchObject({ tenant_id: CANARY, member_id: null })
    expect(h.hook).not.toHaveBeenCalled()
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(h.provision).not.toHaveBeenCalled()
    expect(h.checkout).not.toHaveBeenCalled()
    expect(h.tenantConfirmation).toHaveBeenCalledTimes(1)
    expect(h.tenantConfirmation.mock.calls[0][1]).toMatchObject({ tenantId: CANARY, to: 'kid@example.com' })
  })

  it.each([
    ['a price on the event', { stripePriceId: 'price_1' }, {}],
    ['an add-on', {}, { merch_addons: [{ id: 'addon-1', quantity: 1 }] }],
  ])('%s is refused, with nothing written and Stripe untouched', async (_l, event, extra) => {
    h.getEventBySlug.mockResolvedValue({ ...EVENT, ...event })
    expect(await settle(await post(extra))).toMatchObject({ status: 503, body: { code: 'tenant_payments_unavailable' } })
    expect(writes()).toEqual([])
    expect(h.priceRetrieve).not.toHaveBeenCalled()
    expect(h.checkout).not.toHaveBeenCalled()
    expect(h.findExisting).not.toHaveBeenCalled()
  })

  it('an offer link on a tenant host gets the unknown offer’s answer, and no offer is looked up', async () => {
    h.findOffer.mockResolvedValue({ id: 'off-1', event_slug: 'canary-cup', email: 'kid@example.com', percent_off: 100 })
    const OFFER_INVALID = { status: 400, body: { error: 'This scholarship link is no longer valid. Reply to your scholarship email and we’ll sort it out.' } }
    expect(await settle(await post({ scholarship_token: 'tok' }))).toEqual(OFFER_INVALID)
    expect(h.findOffer).not.toHaveBeenCalled()
    // On Stellr's host, an offer for a tenant's event answers the same as an unknown one.
    onHost(STELLR_TENANT_ID)
    expect(await settle(await post({ scholarship_token: 'tok' }))).toEqual(OFFER_INVALID)
    h.findOffer.mockResolvedValue(null)
    expect(await settle(await post({ scholarship_token: 'tok' }))).toEqual(OFFER_INVALID)
    expect(writes()).toEqual([])
  })

  it('a live tenant event with no start date refuses (owner decision open)', async () => {
    mirror({ starts_at: null })
    expect(await settle(await post())).toMatchObject({ status: 503, body: { code: 'eligibility_unavailable' } })
    expect(writes()).toEqual([])
  })

  it('Stellr’s event named on a tenant host is not found', async () => {
    mirror(null)
    expect(await settle(await post())).toEqual({ status: 404, body: { error: 'Event not found' } })
    expect(writes()).toEqual([])
  })
})

describe('S5 A7: register/individual, the audit event', () => {
  it('a registration records one event after the response, on Stellr’s chain, naming the event’s tenant', async () => {
    await post()
    expect(h.audit).toHaveBeenCalledTimes(1)
    expect(h.audit.mock.calls[0]).toEqual([
      {
        action: 'registration.individual.create',
        actor: { userId: null },
        tenant: { stellr: true },
        target: { table: 'registrations', id: 'reg-1' },
        metadata: { status: 201, event_tenant_id: CANARY },
      },
      { afterResponse: true },
    ])
  })

  it('a refusal is not recorded', async () => {
    await post({ date_of_birth: dateBefore(13) })
    expect(h.audit).not.toHaveBeenCalled()
  })
})

// The traces the slice asks for, through a Stellr event on Stellr's host: the answer
// each person got before A7, and the one tenant_id they now carry.
describe('S5 A7: register/individual, Stellr’s own event answers as before', () => {
  beforeEach(() => {
    onHost(STELLR_TENANT_ID)
    mirror(null)
    h.getEventBySlug.mockResolvedValue({ ...EVENT, title: 'Colorado' })
  })

  it.each([
    ['an adult', '1985-04-01', 'mentor'],
    ['a 13-year-old', AGE_CASES[1].dob, 'participant'],
    ['a 12-year-old under COPPA', AGE_CASES[0].dob, 'participant'],
  ])('%s is registered, with Stellr’s hooks and its tenant', async (_l, dob, role) => {
    const res = await settle(await post({ date_of_birth: dob, event_role: 'mentor', age_bracket: 'college' }))
    expect(res).toEqual({ status: 201, body: { registrationId: 'reg-1', checkoutUrl: 'https://checkout.test/cs_1', signInToken: expect.anything() } })
    expect(rec.payloads('insert', 'participants')[0]).toMatchObject({ tenant_id: STELLR_TENANT_ID, event_role: role, date_of_birth: dob })
    expect(h.dispatch).toHaveBeenCalledTimes(1)
    expect(h.hook).toHaveBeenCalledWith('recordEventParticipation')
    expect(h.tenantConfirmation).not.toHaveBeenCalled()
  })

  it('a 12-year-old under COPPA gets no login, as before', async () => {
    const res = await settle(await post({ date_of_birth: AGE_CASES[0].dob }))
    expect(res.status).toBe(201)
    expect(h.provision.mock.calls[0]).toEqual([
      'kid@example.com', 'K', 'Id', { memberIsNew: true, age: { dateOfBirth: AGE_CASES[0].dob } },
    ])
  })

  it('an unknown date of birth is refused before the owner is read', async () => {
    expect(await settle(await post({ date_of_birth: '' }))).toEqual({
      status: 400, body: { code: 'dob_missing', error: 'Please add your date of birth.' },
    })
    expect(rec.log).toEqual([])
  })

  it('a tenant’s event named on Stellr’s host is not found (the Canary slug), with nothing written', async () => {
    mirror({})
    expect(await settle(await post())).toEqual({ status: 404, body: { error: 'Event not found' } })
    expect(writes()).toEqual([])
  })
})
