import { describe, it, expect, vi, beforeEach } from 'vitest'
import { rec, OPEN_EVENT, CLOSED_EVENT, eqFilter, jsonRequest, settle } from '@/test/registration/fixtures'

// S5 A4: what route.characterisation.test.ts names as unprotected by the handler
// split: the scholarship branches, the merch add-on lines, the resume and
// email-link duplicate answers, the checkout failure paths, and the order of the
// gate's reads. Written and passed against the route BEFORE it was split, then
// left unchanged by the split, so like that suite it says what the route does and
// a failure means the refactor changed behaviour. The split's review added three
// pins (marked below), each also run against the unsplit route.

const h = vi.hoisted(() => ({
  getEventBySlug: vi.fn(),
  getCurrentMember: vi.fn(),
  impersonation: vi.fn(),
  consentBlock: vi.fn(),
  rateLimit: vi.fn(),
  findOffer: vi.fn(),
  attachOffer: vi.fn(),
  confirm: vi.fn(),
  findExisting: vi.fn(),
  resolveDuplicate: vi.fn(),
  linkSchool: vi.fn(),
  syncOptions: vi.fn(),
  dispatch: vi.fn(),
  participation: vi.fn(),
  grant: vi.fn(),
  prepareAddons: vi.fn(),
  addAddons: vi.fn(),
  checkout: vi.fn(),
  ensurePayToken: vi.fn(),
  pendingAddons: vi.fn(),
  payPageUrl: vi.fn(),
  payLink: vi.fn(),
  priceRetrieve: vi.fn(),
  provision: vi.fn(),
  stripeOn: false,
}))

class CheckoutError extends Error {
  constructor(public code: string) {
    super(code)
  }
}

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
vi.mock('@/lib/pending-consent', () => ({ sessionChildAwaitingConsentBlock: h.consentBlock }))
vi.mock('@/lib/clerk-provisioning', () => ({ ensureClerkUserAndSignInToken: h.provision }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: h.rateLimit, HOUR_MS: 3_600_000 }))
vi.mock('@/lib/scholarships', () => ({ findOfferByToken: h.findOffer, attachOfferToRegistration: h.attachOffer }))
vi.mock('@/lib/stripe', () => ({
  stripeClient: () => (h.stripeOn ? { prices: { retrieve: h.priceRetrieve } } : null),
}))
vi.mock('@/lib/registration-duplicates', () => ({
  findExistingRegistrations: h.findExisting,
  resolveDuplicate: h.resolveDuplicate,
}))
vi.mock('@/lib/docusign-agreements', () => ({ dispatchAgreement: h.dispatch }))
vi.mock('@/lib/school-link', () => ({ resolveAndLinkSchool: h.linkSchool }))
vi.mock('@/lib/member-profile-options', () => ({ syncMemberOptionSelections: h.syncOptions }))
vi.mock('@/lib/event-participation-sync', () => ({ recordEventParticipation: h.participation }))
vi.mock('@/lib/auto-membership-grant', () => ({ autoGrantBaseMembership: h.grant }))
vi.mock('@/lib/store/event-merch', () => ({
  prepareRegistrationAddons: h.prepareAddons,
  addRegistrationAddons: h.addAddons,
}))
vi.mock('@/lib/registration-confirm', () => ({ confirmRegistration: h.confirm }))
vi.mock('@/lib/registration-pay-link', () => ({ sendPayLinkEmail: h.payLink }))
vi.mock('@/lib/registration-checkout', () => ({
  createRegistrationCheckout: h.checkout,
  RegistrationCheckoutError: CheckoutError,
  ensurePayToken: h.ensurePayToken,
  mintPayToken: () => 'paytok',
  payPageUrl: h.payPageUrl,
  pendingAddonLines: h.pendingAddons,
}))

const { POST } = await import('./route')

const BODY = {
  event_slug: 'colorado', event_title: 'Client Title',
  email: 'kid@example.com', first_name: 'K', last_name: 'Id', nickname: 'Kay',
  phone: '555', date_of_birth: '1985-04-01', school_name: 'Denver High',
  grade: '9', gender: 'female', ethnicity: ['eth'], t_shirt_size: 'M',
  event_role: 'mentor', age_bracket: 'college',
  dietary_requirements: ['vegan'], health_conditions: 'asthma',
  emergency_contact_first_name: 'P', emergency_contact_last_name: 'Id',
  emergency_contact_email: 'parent@example.com', emergency_contact_phone: '556',
  emergency_contact_relationship: 'Parent',
  school_address_state: 'NV',
}

const post = (overrides: Record<string, unknown> = {}) =>
  POST(jsonRequest('/api/register/individual', { ...BODY, ...overrides }))

const FULL_OFFER = { id: 'offer-1', event_slug: 'colorado', percent_off: 100, registration_id: null }
const HALF_OFFER = { ...FULL_OFFER, percent_off: 50 }
const PRICED = { ...OPEN_EVENT, stripePriceId: 'price_1' }
const UNAVAILABLE = 'Registration is temporarily unavailable. Please try again shortly.'
const SUCCESS_URL = 'https://app.stellreducation.org/community?registered=1&type=individual&payment=success'

/** The writes and hooks of a new adult's registration, up to the add-on pricing. */
const HAPPY = [
  'insert registrations',
  'upsert members',
  'shadow members [m-1]',
  'hook linkSchool',
  'hook syncOptions',
  'insert participants',
  'shadow participants [p-1]',
  'hook participation',
  'hook grant',
  'hook dispatch',
  'hook provision',
  'update members',
  'hook prepareAddons',
]

/** An earlier registration of this person on this event. */
function duplicate(kind: string, type = 'individual') {
  h.resolveDuplicate.mockReturnValue({ kind, registration: { registrationId: 'reg-old', type } })
}

/** That earlier registration's row. */
function existingRow(status: string) {
  rec.respond((c) =>
    c.table === 'registrations' && c.op === 'select' && eqFilter(c, 'id', 'reg-old')
      ? { data: { id: 'reg-old', status, amount_due_cents: 2500 }, error: null }
      : undefined,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  rec.reset()
  h.stripeOn = false
  const hook = (fn: typeof h.linkSchool, label: string, result?: unknown) =>
    fn.mockImplementation(async () => { rec.event(label); return result })
  h.rateLimit.mockImplementation(() => { rec.event('gate rateLimit'); return null })
  hook(h.impersonation, 'gate impersonation', null)
  hook(h.consentBlock, 'gate consent', null)
  hook(h.getCurrentMember, 'gate session', null)
  hook(h.findOffer, 'gate findOffer', null)
  hook(h.getEventBySlug, 'gate event', OPEN_EVENT)
  hook(h.findExisting, 'gate findExisting', new Map())
  h.resolveDuplicate.mockReturnValue({ kind: 'none' })
  hook(h.priceRetrieve, 'gate price', { unit_amount: 2500 })
  hook(h.linkSchool, 'hook linkSchool', { state: 'CO' })
  hook(h.syncOptions, 'hook syncOptions')
  hook(h.attachOffer, 'hook attachOffer')
  hook(h.participation, 'hook participation')
  hook(h.grant, 'hook grant')
  hook(h.dispatch, 'hook dispatch')
  hook(h.provision, 'hook provision', { signInToken: 'tkt', clerkUserId: 'user_new' })
  hook(h.prepareAddons, 'hook prepareAddons', [])
  hook(h.addAddons, 'hook addAddons')
  hook(h.confirm, 'hook confirm')
  hook(h.pendingAddons, 'hook pendingAddons', [])
  hook(h.checkout, 'hook checkout', { url: 'https://checkout.test' })
  hook(h.payLink, 'hook payLink', { sent: true, recipients: [] })
  h.ensurePayToken.mockResolvedValue('paytok-old')
  h.payPageUrl.mockImplementation((slug: string, token: string) => `https://pay.test/${slug}/${token}`)
})

/** The log without the gate's reads: writes, shadow syncs and hooks, in order. */
const writes = () => rec.log.filter((l) => !l.startsWith('select ') && !l.startsWith('gate '))

describe('POST /api/register/individual — the gate, in order', () => {
  it('reads in this order, and writes nothing until the last check has passed', async () => {
    h.stripeOn = true
    h.getEventBySlug.mockImplementation(async () => { rec.event('gate event'); return PRICED })
    h.findOffer.mockImplementation(async () => { rec.event('gate findOffer'); return HALF_OFFER })
    await post({ scholarship_token: 'tok' })
    expect(rec.log.slice(0, 9)).toEqual([
      'gate rateLimit',
      'gate impersonation',
      'gate consent',
      'gate session',
      'gate findOffer',
      'gate event',
      'gate findExisting',
      'gate price',
      'insert registrations',
    ])
  })

  it('a body that is not JSON is a 500, before the rate limit', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(new Request('https://www.stellreducation.org/api/register/individual', {
      method: 'POST', body: 'not json',
    }) as never)
    expect(await settle(res)).toEqual({ status: 500, body: { error: 'Internal server error' } })
    expect(rec.log).toEqual([])
    errors.mockRestore()
  })

  it('a JSON body of null is a 500, before the rate limit', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(jsonRequest('/api/register/individual', null))
    expect(await settle(res)).toEqual({ status: 500, body: { error: 'Internal server error' } })
    expect(rec.log).toEqual([])
    errors.mockRestore()
  })

  it('a rate-limited caller gets that response, with nothing else run', async () => {
    h.rateLimit.mockReturnValue(new Response('{"error":"slow"}', { status: 429 }))
    expect(await settle(await post())).toEqual({ status: 429, body: { error: 'slow' } })
    expect(h.impersonation).not.toHaveBeenCalled()
    expect(rec.log).toEqual([])
  })

  it('a slug that is not a string is not used as the rate limit sub-key', async () => {
    await post({ event_slug: 42 })
    expect(h.rateLimit).toHaveBeenCalledWith(expect.anything(), 'register-individual', { limit: 3, windowMs: 3_600_000 }, undefined)
  })

  it('a child awaiting consent gets that response, before the session is read', async () => {
    h.consentBlock.mockResolvedValue(new Response('{"code":"consent_pending"}', { status: 403 }))
    expect(await settle(await post())).toEqual({ status: 403, body: { code: 'consent_pending' } })
    expect(h.getCurrentMember).not.toHaveBeenCalled()
  })

  it('a session read that throws counts as signed out', async () => {
    h.getCurrentMember.mockRejectedValue(new Error('clerk down'))
    expect((await post()).status).toBe(201)
    expect(h.provision).toHaveBeenCalledTimes(1)
  })

  it.each(['event_slug', 'email', 'first_name', 'last_name'])('no %s is a 400, before the event is read', async (field) => {
    expect(await settle(await post({ [field]: '' }))).toEqual({ status: 400, body: { error: 'Missing required fields' } })
    expect(h.getEventBySlug).not.toHaveBeenCalled()
  })

  // Added in the split's review.
  it('a missing field is refused before a bad scholarship link, with no offer lookup', async () => {
    expect(await settle(await post({ first_name: '', scholarship_token: 'gone' }))).toEqual({
      status: 400,
      body: { error: 'Missing required fields' },
    })
    expect(h.findOffer).not.toHaveBeenCalled()
  })

  it('only a school address submitted: it becomes the email, and is stored as the school email', async () => {
    expect((await post({ email: '', school_email: 'Kid@School.example.com' })).status).toBe(201)
    const [row] = rec.payloads('insert', 'participants') as Record<string, unknown>[]
    expect(row).toMatchObject({ email: 'kid@school.example.com', school_email: 'kid@school.example.com' })
    const [member] = rec.payloads('upsert', 'members') as Record<string, unknown>[]
    expect(member).toMatchObject({ email: 'kid@school.example.com', school_email: 'kid@school.example.com' })
  })

  it('both addresses submitted: personal is the email, and the school one goes beside it', async () => {
    expect((await post({ school_email: 'kid@school.example.com' })).status).toBe(201)
    const [row] = rec.payloads('insert', 'participants') as Record<string, unknown>[]
    expect(row).toMatchObject({ email: 'kid@example.com', school_email: 'kid@school.example.com' })
  })

  it('no school is a 400 after the window and before the date of birth', async () => {
    const refused = { status: 400, body: { error: 'Please select your school.' } }
    expect(await settle(await post({ school_name: '   ', date_of_birth: '' }))).toEqual(refused)
    expect(await settle(await post({ school_name: 42 }))).toEqual(refused)
    h.getEventBySlug.mockResolvedValue(CLOSED_EVENT)
    expect((await post({ school_name: '' })).status).toBe(403)
  })

  it('a school id alone is enough, and is passed on with the address', async () => {
    expect((await post({
      school_name: '', school_id: 's-1',
      school_address_street: '1 Main', school_address_city: 'Reno', school_address_zip: '89501',
    })).status).toBe(201)
    expect(h.linkSchool.mock.calls[0][1]).toEqual(['m-1'])
    expect(h.linkSchool.mock.calls[0][2]).toEqual({
      id: 's-1', name: '', address_street: '1 Main', address_city: 'Reno', address_state: 'NV', address_zip: '89501',
    })
  })

  it('an event with no title falls back to the submitted one', async () => {
    h.getEventBySlug.mockResolvedValue({ ...OPEN_EVENT, title: undefined })
    await post()
    const [reg] = rec.payloads('insert', 'registrations') as Record<string, unknown>[]
    expect(reg.event_title).toBe('Client Title')
  })
})

describe('POST /api/register/individual — scholarship offers', () => {
  const REFUSED = {
    status: 400,
    body: { error: 'This scholarship link is no longer valid. Reply to your scholarship email and we’ll sort it out.' },
  }

  it('an offer that is not live is refused before the event is read', async () => {
    expect(await settle(await post({ scholarship_token: 'gone' }))).toEqual(REFUSED)
    expect(h.findOffer).toHaveBeenCalledWith(expect.anything(), 'gone')
    expect(h.getEventBySlug).not.toHaveBeenCalled()
    expect(writes()).toEqual([])
  })

  it('an offer for another event is refused', async () => {
    h.findOffer.mockResolvedValue({ ...HALF_OFFER, event_slug: 'nevada' })
    expect(await settle(await post({ scholarship_token: 'tok' }))).toEqual(REFUSED)
    expect(writes()).toEqual([])
  })

  it('no token, no lookup', async () => {
    await post()
    expect(h.findOffer).not.toHaveBeenCalled()
    expect(h.attachOffer).not.toHaveBeenCalled()
  })

  it('a live offer gets past a closed window, but not an unknown event', async () => {
    h.findOffer.mockResolvedValue(HALF_OFFER)
    h.getEventBySlug.mockResolvedValue(CLOSED_EVENT)
    expect((await post({ scholarship_token: 'tok' })).status).toBe(201)
    h.getEventBySlug.mockResolvedValue(null)
    expect((await post({ scholarship_token: 'tok' })).status).toBe(404)
  })

  it('the offer is attached right after the participant row, with the amount due and the member', async () => {
    h.stripeOn = true
    h.getEventBySlug.mockResolvedValue(PRICED)
    h.findOffer.mockResolvedValue(HALF_OFFER)
    expect((await post({ scholarship_token: 'tok' })).status).toBe(201)
    const log = writes()
    expect(log.indexOf('hook attachOffer')).toBe(log.indexOf('shadow participants [p-1]') + 1)
    expect(log.indexOf('hook participation')).toBe(log.indexOf('hook attachOffer') + 1)
    expect(h.attachOffer).toHaveBeenCalledWith(
      expect.anything(),
      HALF_OFFER,
      { id: 'reg-1', status: 'pending', amount_due_cents: 2500 },
      'm-1',
    )
  })

  it('a partial scholarship still goes to checkout', async () => {
    h.stripeOn = true
    h.findOffer.mockResolvedValue(HALF_OFFER)
    const res = await settle(await post({ scholarship_token: 'tok' }))
    expect(res.body).toMatchObject({ checkoutUrl: 'https://checkout.test' })
    expect(h.confirm).not.toHaveBeenCalled()
  })

  it('a full scholarship with no add-ons confirms here, with no checkout', async () => {
    h.stripeOn = true
    h.findOffer.mockResolvedValue(FULL_OFFER)
    expect(await settle(await post({ scholarship_token: 'tok' }))).toEqual({
      status: 201,
      body: { registrationId: 'reg-1', checkoutUrl: null, signInToken: 'tkt' },
    })
    expect(h.confirm).toHaveBeenCalledWith('reg-1', false)
    expect(h.checkout).not.toHaveBeenCalled()
    expect(writes().at(-1)).toBe('hook confirm')
  })

  it('a full scholarship with an add-on goes to checkout, and is not confirmed', async () => {
    h.stripeOn = true
    h.findOffer.mockResolvedValue(FULL_OFFER)
    h.prepareAddons.mockResolvedValue([{ id: 'line' }])
    const res = await settle(await post({ scholarship_token: 'tok' }))
    expect(res.body).toMatchObject({ checkoutUrl: 'https://checkout.test' })
    expect(h.confirm).not.toHaveBeenCalled()
  })
})

describe('POST /api/register/individual — someone already on this event', () => {
  it('resuming with Stripe on is a 200 with a fresh checkout, and nothing else written', async () => {
    h.stripeOn = true
    h.getEventBySlug.mockResolvedValue(PRICED)
    duplicate('resume')
    expect(await settle(await post())).toEqual({
      status: 200,
      body: { resume: true, registrationId: 'reg-old', checkoutUrl: 'https://checkout.test' },
    })
    expect(writes()).toEqual(['hook checkout'])
    expect(h.checkout).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'reg-old', {
      event: PRICED,
      customerEmail: 'kid@example.com',
      successUrl: SUCCESS_URL,
      cancelUrl: 'https://pay.test/colorado/paytok-old',
    })
    expect(h.payPageUrl).toHaveBeenCalledWith('colorado', 'paytok-old', { cancelled: true })
    expect(h.priceRetrieve).not.toHaveBeenCalled()
  })

  const ALREADY = {
    status: 409,
    body: {
      code: 'already_registered',
      error: 'kid@example.com is already registered for this event. If that’s you, sign in to see it under Account → Events.',
    },
  }

  it('resuming with Stripe off is the plain already-registered answer', async () => {
    duplicate('resume')
    expect(await settle(await post())).toEqual(ALREADY)
  })

  it('a resume checkout with nothing to collect is the plain answer, and is not logged', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.stripeOn = true
    duplicate('resume')
    h.checkout.mockRejectedValue(new CheckoutError('nothing_to_pay'))
    expect(await settle(await post())).toEqual(ALREADY)
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('a resume checkout that fails is logged, and is the plain answer', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.stripeOn = true
    duplicate('resume')
    const boom = new Error('stripe down')
    h.checkout.mockRejectedValue(boom)
    expect(await settle(await post())).toEqual(ALREADY)
    expect(errors).toHaveBeenCalledWith('[register/individual] resume checkout failed:', boom)
    errors.mockRestore()
  })

  it('someone else naming the address gets the pay link by email, masked in the answer', async () => {
    duplicate('email_link')
    h.payLink.mockResolvedValue({ sent: true, recipients: ['kid@example.com', 'parent@example.com'] })
    expect(await settle(await post())).toEqual({
      status: 409,
      body: {
        code: 'unfinished_registration',
        error: 'This email already has an unfinished registration for this event. We’ve emailed a link to complete payment to k***@example.com and p***@example.com — check spam if it hasn’t arrived in a few minutes.',
      },
    })
    expect(h.payLink).toHaveBeenCalledWith(expect.anything(), 'reg-old')
  })

  it('inside the resend cooldown it says so, and names the submitted address when it has no recipients', async () => {
    duplicate('email_link')
    h.payLink.mockResolvedValue({ sent: false, reason: 'cooldown', recipients: [] })
    expect(await settle(await post())).toEqual({
      status: 409,
      body: {
        code: 'unfinished_registration',
        error: 'This email already has an unfinished registration for this event. We recently emailed a link to complete payment to k***@example.com — check spam if it hasn’t arrived in a few minutes.',
      },
    })
  })

  it('a pay link that fails to send is logged, and the answer stands', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    duplicate('email_link')
    const boom = new Error('resend down')
    h.payLink.mockRejectedValue(boom)
    const res = await settle(await post())
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ code: 'unfinished_registration' })
    expect(errors).toHaveBeenCalledWith('[register/individual] pay-link resend failed (non-fatal):', boom)
    errors.mockRestore()
  })

  it('someone in a group is told to ask the organiser', async () => {
    duplicate('in_group', 'group')
    expect(await settle(await post())).toEqual({
      status: 409,
      body: {
        code: 'in_group',
        error: 'kid@example.com is already part of a group registration for this event. Ask your teacher or group organiser if anything needs changing.',
      },
    })
  })

  it.each(['resume', 'email_link'])('an unfinished group registration (%s) is not resumed from this form', async (kind) => {
    h.stripeOn = true
    duplicate(kind, 'group')
    expect(await settle(await post())).toEqual({
      status: 409,
      body: {
        code: 'already_registered',
        error: 'kid@example.com already has a group registration for this event. Complete its payment from the link in your confirmation email, or under Account → Teams.',
      },
    })
    expect(h.checkout).not.toHaveBeenCalled()
    expect(h.payLink).not.toHaveBeenCalled()
  })

  it('a duplicate is answered before the campaign refusal and the fee lookup', async () => {
    h.stripeOn = true
    h.getEventBySlug.mockResolvedValue({ ...PRICED, activityType: 'campaign', registrationOpen: true })
    duplicate('already_registered')
    expect(await settle(await post())).toEqual(ALREADY)
    expect(h.priceRetrieve).not.toHaveBeenCalled()
  })

  it('the duplicate check gets the email, the slug and whether the session matches', async () => {
    h.getCurrentMember.mockResolvedValue({ email: 'Kid@Example.com' })
    await post()
    expect(h.findExisting).toHaveBeenCalledWith(expect.anything(), ['kid@example.com'], 'colorado')
    expect(h.resolveDuplicate).toHaveBeenCalledWith(undefined, { sessionMatches: true })
  })

  describe('with a scholarship', () => {
    beforeEach(() => {
      h.findOffer.mockResolvedValue(FULL_OFFER)
    })

    it('a full one attaches and confirms a pending registration with nothing else owed: a 200, no token', async () => {
      duplicate('resume')
      existingRow('pending')
      expect(await settle(await post({ scholarship_token: 'tok' }))).toEqual({
        status: 200,
        body: { registrationId: 'reg-old', checkoutUrl: null, signInToken: null },
      })
      expect(h.attachOffer).toHaveBeenCalledWith(
        expect.anything(),
        FULL_OFFER,
        { id: 'reg-old', status: 'pending', amount_due_cents: 2500 },
        null,
      )
      expect(h.pendingAddons).toHaveBeenCalledWith(expect.anything(), 'reg-old')
      expect(h.confirm).toHaveBeenCalledWith('reg-old', false)
      expect(writes()).toEqual(['hook attachOffer', 'hook pendingAddons', 'hook confirm'])
    })

    it('with add-ons still owed it attaches but does not confirm', async () => {
      duplicate('resume')
      existingRow('pending')
      h.pendingAddons.mockResolvedValue([{ id: 'line' }])
      expect(await settle(await post({ scholarship_token: 'tok' }))).toEqual(ALREADY)
      expect(h.attachOffer).toHaveBeenCalledTimes(1)
      expect(h.confirm).not.toHaveBeenCalled()
    })

    it('a partial one attaches but does not confirm', async () => {
      h.findOffer.mockResolvedValue(HALF_OFFER)
      duplicate('resume')
      existingRow('pending')
      await post({ scholarship_token: 'tok' })
      expect(h.attachOffer).toHaveBeenCalledTimes(1)
      expect(h.confirm).not.toHaveBeenCalled()
    })

    it('a registration already confirmed gets the offer attached, and the plain answer', async () => {
      duplicate('already_registered')
      existingRow('confirmed')
      expect(await settle(await post({ scholarship_token: 'tok' }))).toEqual(ALREADY)
      expect(h.attachOffer).toHaveBeenCalledTimes(1)
      expect(h.confirm).not.toHaveBeenCalled()
    })

    it('a row that cannot be found attaches nothing', async () => {
      duplicate('resume')
      expect(await settle(await post({ scholarship_token: 'tok' }))).toEqual(ALREADY)
      expect(h.attachOffer).not.toHaveBeenCalled()
    })

    it.each([
      ['a group registration', 'resume', 'group'],
      ['someone in a group', 'in_group', 'individual'],
    ])('%s is not touched', async (_l, kind, type) => {
      duplicate(kind, type)
      existingRow('pending')
      expect((await post({ scholarship_token: 'tok' })).status).toBe(409)
      expect(h.attachOffer).not.toHaveBeenCalled()
      expect(h.confirm).not.toHaveBeenCalled()
    })
  })
})

describe('POST /api/register/individual — members and the rows written', () => {
  it('the member row, field for field', async () => {
    await post({ school_email: 'kid@school.example.com' })
    expect(rec.payloads('upsert', 'members')).toEqual([{
      email: 'kid@example.com',
      school_email: 'kid@school.example.com',
      first_name: 'K',
      last_name: 'Id',
      nickname: 'Kay',
      phone: '555',
      date_of_birth: '1985-04-01',
      gender: 'female',
      grade: 'grade_9',
      tshirt_size: 'M',
      age_bracket: 'college',
      event_role: 'mentor',
      is_active: true,
      health_conditions: 'asthma',
      ec_first_name: 'P',
      ec_last_name: 'Id',
      ec_email: 'parent@example.com',
      ec_phone: '556',
      ec_relationship: 'Parent',
    }])
    expect(rec.calls.find((c) => c.op === 'upsert')?.table).toBe('members')
  })

  it('a member upsert that fails is not fatal: the participant has no member, and nothing is linked', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    rec.respond((c) => (c.op === 'upsert' ? { data: null, error: { message: 'boom' } } : undefined))
    expect((await post()).status).toBe(201)
    const [row] = rec.payloads('insert', 'participants') as Record<string, unknown>[]
    expect(row.member_id).toBeNull()
    expect(h.linkSchool.mock.calls[0][1]).toEqual([])
    expect(h.syncOptions).not.toHaveBeenCalled()
    expect(h.grant).toHaveBeenCalledWith(expect.anything(), null)
    expect(rec.payloads('update', 'members')).toEqual([])
    errors.mockRestore()
  })

  // Added in the split's review.
  it('a signed-in member whose upsert fails keeps the known member id on the participant', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.getCurrentMember.mockResolvedValue({ email: 'kid@example.com' })
    rec.respond((c) => {
      if (c.op === 'upsert') return { data: null, error: { message: 'boom' } }
      if (c.table === 'members' && c.op === 'select' && eqFilter(c, 'email', 'kid@example.com')) {
        return { data: { id: 'm-known' }, error: null }
      }
      return undefined
    })
    expect((await post()).status).toBe(201)
    const [row] = rec.payloads('insert', 'participants') as Record<string, unknown>[]
    expect(row.member_id).toBe('m-known')
    expect(h.linkSchool.mock.calls[0][1]).toEqual(['m-known'])
    expect(h.grant).toHaveBeenCalledWith(expect.anything(), 'm-known')
    errors.mockRestore()
  })

  // Added in the split's review.
  it('a padded, timestamped date of birth is stored and sent as the plain date', async () => {
    expect((await post({ date_of_birth: ' 1985-04-01T00:00:00Z ' })).status).toBe(201)
    const [member] = rec.payloads('upsert', 'members') as Record<string, unknown>[]
    const [row] = rec.payloads('insert', 'participants') as Record<string, unknown>[]
    expect(member.date_of_birth).toBe('1985-04-01')
    expect(row.date_of_birth).toBe('1985-04-01')
    expect(h.dispatch.mock.calls[0][1]).toMatchObject({ dateOfBirth: '1985-04-01' })
    expect(h.provision.mock.calls[0][3]).toMatchObject({ age: { dateOfBirth: '1985-04-01' } })
  })

  it('options are synced for the member, and event participation carries the server title', async () => {
    await post()
    expect(h.syncOptions).toHaveBeenCalledWith(expect.anything(), [
      { memberId: 'm-1', ethnicity: ['eth'], dietary: ['vegan'] },
    ])
    expect(h.participation).toHaveBeenCalledWith(expect.anything(), {
      memberId: 'm-1', eventSlug: 'colorado', eventTitle: 'Colorado', registrationId: 'reg-1',
    })
    expect(h.grant).toHaveBeenCalledWith(expect.anything(), 'm-1')
  })

  it('the agreement, field for field', async () => {
    await post()
    expect(h.dispatch).toHaveBeenCalledWith(expect.anything(), {
      participantId: 'p-1',
      memberId: 'm-1',
      eventSlug: 'colorado',
      eventTitle: 'Colorado',
      firstName: 'K',
      lastName: 'Id',
      email: 'kid@example.com',
      phone: '555',
      dateOfBirth: '1985-04-01',
      eventRole: 'mentor',
      schoolName: 'Denver High',
      schoolState: 'CO',
      guardianFirstName: 'P',
      guardianLastName: 'Id',
      guardianEmail: 'parent@example.com',
      guardianPhone: '556',
      relationship: 'Parent',
      grade: 'grade_9',
    })
  })

  it('the agreement falls back to the submitted state, then to null, when the school has none', async () => {
    h.linkSchool.mockResolvedValue(null)
    await post()
    expect(h.dispatch.mock.calls[0][1]).toMatchObject({ schoolState: 'NV' })
    await post({ school_address_state: undefined })
    expect(h.dispatch.mock.calls[1][1]).toMatchObject({ schoolState: null })
  })

  it('provisioning a login gets the name, whether the member is new, and the date of birth', async () => {
    await post()
    expect(h.provision).toHaveBeenCalledWith('kid@example.com', 'K', 'Id', {
      memberIsNew: true,
      age: { dateOfBirth: '1985-04-01' },
    })
  })

  it('no token means no clerk_user_id write', async () => {
    h.provision.mockResolvedValue({ signInToken: null, clerkUserId: 'user_existing' })
    const res = await settle(await post())
    expect(res.body).toMatchObject({ signInToken: null })
    expect(rec.payloads('update', 'members')).toEqual([])
  })

  it('a Clerk failure is logged, and the registration stands with no token', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const boom = new Error('clerk down')
    h.provision.mockRejectedValue(boom)
    expect(await settle(await post())).toEqual({
      status: 201,
      body: { registrationId: 'reg-1', checkoutUrl: null, signInToken: null },
    })
    expect(errors).toHaveBeenCalledWith('Clerk provisioning (non-fatal):', boom)
    errors.mockRestore()
  })

  it('a hook that throws after the participant is written is a 500, and the rows stay', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.dispatch.mockRejectedValue(new Error('docusign down'))
    expect(await settle(await post())).toEqual({ status: 500, body: { error: 'Internal server error' } })
    expect(writes()).not.toContain('delete registrations')
    errors.mockRestore()
  })
})

describe('POST /api/register/individual — add-ons and checkout', () => {
  it('add-ons are priced from the submitted lines and added to the member, before the checkout', async () => {
    h.stripeOn = true
    const lines = [{ id: 'line' }]
    h.prepareAddons.mockImplementation(async () => { rec.event('hook prepareAddons'); return lines })
    await post({ merch_addons: [{ variantId: 'v1' }] })
    expect(h.prepareAddons).toHaveBeenCalledWith(expect.anything(), 'colorado', [{ variantId: 'v1' }])
    expect(h.addAddons).toHaveBeenCalledWith(expect.anything(), 'reg-1', lines, 'm-1')
    expect(writes().slice(HAPPY.length - 1)).toEqual([
      'hook prepareAddons', 'hook addAddons', 'hook checkout', 'hook payLink',
    ])
  })

  it('no add-ons submitted is an empty list, and none are added', async () => {
    await post()
    expect(h.prepareAddons).toHaveBeenCalledWith(expect.anything(), 'colorado', [])
    expect(h.addAddons).not.toHaveBeenCalled()
  })

  it('Stripe off: no checkout, and add-ons are still kept', async () => {
    h.prepareAddons.mockResolvedValue([{ id: 'line' }])
    expect(await settle(await post())).toEqual({
      status: 201,
      body: { registrationId: 'reg-1', checkoutUrl: null, signInToken: 'tkt' },
    })
    expect(h.addAddons).toHaveBeenCalledTimes(1)
    expect(h.checkout).not.toHaveBeenCalled()
  })

  it('the checkout gets the second read of the event, the URLs and the pay token', async () => {
    h.stripeOn = true
    const second = { ...PRICED, stripePriceId: 'price_2' }
    h.getEventBySlug.mockResolvedValueOnce(PRICED).mockResolvedValueOnce(second)
    await post()
    expect(h.checkout).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'reg-1', {
      event: second,
      customerEmail: 'kid@example.com',
      successUrl: SUCCESS_URL,
      cancelUrl: 'https://pay.test/colorado/paytok',
    })
    expect(h.payPageUrl).toHaveBeenCalledWith('colorado', 'paytok', { cancelled: true })
    expect(h.payLink).toHaveBeenCalledWith(expect.anything(), 'reg-1', { force: true })
  })

  it('a second event read that throws is a 500, after the rows are written', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.getEventBySlug.mockResolvedValueOnce(OPEN_EVENT).mockRejectedValueOnce(new Error('sanity timeout'))
    expect(await settle(await post())).toEqual({ status: 500, body: { error: 'Internal server error' } })
    expect(writes()).toEqual(HAPPY.slice(0, -1))
    errors.mockRestore()
  })

  it('a free event with Stripe on: nothing to pay is a 201 with no checkout and no pay link', async () => {
    h.stripeOn = true
    h.checkout.mockRejectedValue(new CheckoutError('nothing_to_pay'))
    expect(await settle(await post())).toEqual({
      status: 201,
      body: { registrationId: 'reg-1', checkoutUrl: null, signInToken: 'tkt' },
    })
    expect(h.priceRetrieve).not.toHaveBeenCalled()
    expect(h.payLink).not.toHaveBeenCalled()
  })

  it.each([
    ['another checkout error', () => new CheckoutError('unresolved_event')],
    ['a Stripe failure', () => new Error('stripe down')],
  ])('%s is a 500, and the rows stay', async (_l, make) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.stripeOn = true
    h.checkout.mockRejectedValue(make())
    expect(await settle(await post())).toEqual({ status: 500, body: { error: 'Internal server error' } })
    expect(writes()).not.toContain('delete registrations')
    expect(h.payLink).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('a pay-link email that fails is logged, and the checkout still goes back', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.stripeOn = true
    const boom = new Error('resend down')
    h.payLink.mockRejectedValue(boom)
    expect(await settle(await post())).toEqual({
      status: 201,
      body: { registrationId: 'reg-1', checkoutUrl: 'https://checkout.test', signInToken: 'tkt' },
    })
    expect(errors).toHaveBeenCalledWith('[register/individual] pay-link email failed (non-fatal):', boom)
    errors.mockRestore()
  })

  it('a price with no unit amount is stored as free', async () => {
    h.stripeOn = true
    h.getEventBySlug.mockResolvedValue(PRICED)
    h.priceRetrieve.mockResolvedValue({ unit_amount: null })
    await post()
    const [reg] = rec.payloads('insert', 'registrations') as Record<string, unknown>[]
    expect(reg.amount_due_cents).toBe(0)
  })
})
