import { describe, it, expect, vi, beforeEach } from 'vitest'
import { rec, OPEN_EVENT, CLOSED_EVENT, jsonRequest, settle } from '@/test/registration/fixtures'

// S5 A1: characterisation of POST /api/register/pay as it stands on 4 Nov 2026.
// The route writes no participants and is not split in S5, but the later event
// resolver (A7) reads through it, so its answers are pinned here too. pay-seat,
// the fifth register route, is not covered here.
//
// Like the three gates, pay fails closed on the event lookup: with no event, the
// window and the fee cannot be known. An outage is a retryable 503 and an unknown
// slug the 503 no_price, and no checkout is made.

const h = vi.hoisted(() => ({
  getEventBySlug: vi.fn(async (_slug: string): Promise<unknown> => null),
  findOffer: vi.fn(async (): Promise<unknown> => null),
  createCheckout: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ url: 'https://checkout.test/cs_1' })),
  stripe: {} as unknown,
}))

vi.mock('@/lib/supabase', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return { supabaseServer: () => rec.client() }
})
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: () => {} }))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: h.getEventBySlug }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: () => null }))
vi.mock('@/lib/scholarships', () => ({ findOfferForRegistration: h.findOffer }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => h.stripe }))
vi.mock('@/lib/registration-checkout', async () => {
  const actual = await vi.importActual<typeof import('@/lib/registration-checkout')>('@/lib/registration-checkout')
  return { ...actual, createRegistrationCheckout: h.createCheckout }
})

const { POST } = await import('./route')
const { RegistrationCheckoutError } = await import('@/lib/registration-checkout')
const realCheckout = (await vi.importActual<typeof import('@/lib/registration-checkout')>('@/lib/registration-checkout'))
  .createRegistrationCheckout

const TOKEN = 'ab'.repeat(32)
const NOT_VALID = { status: 404, body: { error: 'This link isn’t valid.' } }

const post = (body: unknown = { token: TOKEN }) => POST(jsonRequest('/api/register/pay', body))

function registrationIs(reg: Record<string, unknown> | null) {
  rec.respond((c) => (c.table === 'registrations' && c.op === 'select' ? { data: reg, error: null } : undefined))
}

const PENDING = { id: 'reg-1', event_slug: 'colorado', type: 'individual', status: 'pending' }

beforeEach(() => {
  vi.clearAllMocks()
  rec.reset()
  h.stripe = {}
  h.getEventBySlug.mockResolvedValue(OPEN_EVENT)
  h.findOffer.mockResolvedValue(null)
  h.createCheckout.mockResolvedValue({ url: 'https://checkout.test/cs_1' })
  registrationIs(PENDING)
})

describe('characterisation: POST /api/register/pay', () => {
  it.each([
    ['a malformed token', { token: 'nope' }],
    ['an uppercase token', { token: TOKEN.toUpperCase() }],
    ['no token', {}],
  ])('%s is a 404 before any read', async (_l, b) => {
    expect(await settle(await post(b))).toEqual(NOT_VALID)
    expect(rec.log).toEqual([])
  })

  it('an unknown token is a 404', async () => {
    registrationIs(null)
    expect(await settle(await post())).toEqual(NOT_VALID)
  })

  it('a confirmed registration is a 409 already_paid', async () => {
    registrationIs({ ...PENDING, status: 'confirmed' })
    expect(await settle(await post())).toEqual({
      status: 409, body: { error: 'This registration is already paid.', code: 'already_paid' },
    })
  })

  it('any other status is a 409 not_pending', async () => {
    registrationIs({ ...PENDING, status: 'withdrawn' })
    expect(await settle(await post())).toEqual({
      status: 409, body: { error: 'This registration has no payment outstanding.', code: 'not_pending' },
    })
  })

  it('a closed window is a 403', async () => {
    h.getEventBySlug.mockResolvedValue(CLOSED_EVENT)
    expect(await settle(await post())).toEqual({
      status: 403, body: { error: 'Registration for this event has closed.' },
    })
    expect(h.createCheckout).not.toHaveBeenCalled()
  })

  it('a closed window with a scholarship offer can still pay', async () => {
    h.getEventBySlug.mockResolvedValue(CLOSED_EVENT)
    h.findOffer.mockResolvedValue({ id: 'sch-1' })
    expect(await settle(await post())).toEqual({ status: 200, body: { url: 'https://checkout.test/cs_1' } })
  })

  describe('with the real checkout', () => {
    const FEE_REG = {
      event_title: 'Colorado', invoice_requested: false, member_pays_individually: false,
      adult_count: 1, student_count: 2, teacher_first_name: 'T', teacher_last_name: 'Eacher',
      teacher_email: 'teacher@example.com', checkout_session_id: null,
    }
    let createSession: ReturnType<typeof vi.fn>
    let retrievePrice: ReturnType<typeof vi.fn>

    /** The registration, and the paid add-ons pending on its event-merch order. */
    function withRegistration(type: string, addons: Array<Record<string, unknown>>) {
      rec.respond((c) => {
        if (c.table === 'registrations' && c.op === 'select') {
          return { data: { ...PENDING, ...FEE_REG, type }, error: null }
        }
        if (c.table === 'store_orders') return { data: addons.length > 0 ? { id: 'order-1' } : null, error: null }
        if (c.table === 'store_order_items') return { data: addons, error: null }
        if (c.table === 'participants' && c.op === 'select') {
          return { data: { first_name: 'K', last_name: 'Id', email: 'kid@example.com' }, error: null }
        }
        return undefined
      })
    }

    const SHIRT = { name: 'Shirt', qty: 1, unit_amount_cents: 1500 }

    beforeEach(() => {
      createSession = vi.fn(async () => ({ id: 'cs_1', url: 'https://checkout.test/cs_real' }))
      retrievePrice = vi.fn(async () => ({ unit_amount: 2500 }))
      h.stripe = {
        prices: { retrieve: retrievePrice },
        checkout: { sessions: { create: createSession, expire: vi.fn() } },
      }
      h.createCheckout.mockImplementation(realCheckout as (...args: unknown[]) => Promise<unknown>)
    })

    describe.each([
      ['individual', []],
      ['individual', [SHIRT]],
      ['group', []],
    ])('a %s registration with add-ons %j', (type, addons) => {
      it('a Sanity outage is a retryable 503, and no checkout is made', async () => {
        h.getEventBySlug.mockRejectedValue(new Error('sanity timeout'))
        withRegistration(type, addons)
        expect(await settle(await post())).toEqual({
          status: 503, body: { error: 'Payment could not be started. Please try again shortly.' },
        })
        expect(h.createCheckout).not.toHaveBeenCalled()
        expect(createSession).not.toHaveBeenCalled()
      })

      it('an unknown event slug is the 503 no_price, and no checkout is made', async () => {
        h.getEventBySlug.mockResolvedValue(null)
        withRegistration(type, addons)
        expect(await settle(await post())).toEqual({
          status: 503,
          body: { error: 'This event’s registration fee is misconfigured — please contact Stellr.', code: 'no_price' },
        })
        expect(h.createCheckout).not.toHaveBeenCalled()
        expect(createSession).not.toHaveBeenCalled()
      })
    })

    it('a scholarship offer does not get an unresolved event past the refusal', async () => {
      h.getEventBySlug.mockResolvedValue(null)
      h.findOffer.mockResolvedValue({ id: 'sch-1' })
      withRegistration('individual', [SHIRT])
      expect((await settle(await post())).status).toBe(503)
      expect(createSession).not.toHaveBeenCalled()
    })

    it('an individual on a priced event pays the fee and the add-ons', async () => {
      h.getEventBySlug.mockResolvedValue({ ...OPEN_EVENT, stripePriceId: 'price_1' })
      withRegistration('individual', [SHIRT])
      expect(await settle(await post())).toEqual({ status: 200, body: { url: 'https://checkout.test/cs_real' } })
      const [params] = createSession.mock.calls[0] as [{ line_items: unknown[] }]
      expect(params.line_items).toEqual([
        { price: 'price_1', quantity: 1 },
        { quantity: 1, price_data: { currency: 'usd', unit_amount: 1500, product_data: { name: 'Shirt' } } },
      ])
    })

    it('a free event, resolved with no price, still checks out its paid add-ons', async () => {
      withRegistration('individual', [SHIRT])
      expect(await settle(await post())).toEqual({ status: 200, body: { url: 'https://checkout.test/cs_real' } })
      const [params] = createSession.mock.calls[0] as [{ line_items: unknown[] }]
      expect(params.line_items).toEqual([
        { quantity: 1, price_data: { currency: 'usd', unit_amount: 1500, product_data: { name: 'Shirt' } } },
      ])
    })
  })

  it('Stripe off is a 503', async () => {
    h.stripe = null
    expect(await settle(await post())).toEqual({ status: 503, body: { error: 'Payments are not configured.' } })
  })

  it.each([
    ['individual', 'individual'],
    ['group', 'group'],
    ['campaign', 'group'],
  ])('a %s registration returns to the %s confirmation page', async (type, returnType) => {
    registrationIs({ ...PENDING, type })
    await post()
    expect(h.createCheckout).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 'reg-1',
      expect.objectContaining({
        customerEmail: null,
        successUrl: expect.stringMatching(new RegExp(`/register/colorado/confirmation\\?id=reg-1&type=${returnType}&payment=success$`)),
        cancelUrl: expect.stringMatching(new RegExp(`/register/colorado/pay/${TOKEN}\\?cancelled=1$`)),
      }),
    )
  })

  it.each([
    ['not_found', 404, 'stored message'],
    ['not_pending', 409, 'stored message'],
    ['no_price', 503, 'This event’s registration fee is misconfigured — please contact Stellr.'],
    ['nothing_to_pay', 400, 'There’s nothing left to pay on this registration. Reply to your registration email if you think that’s wrong.'],
    ['not_card', 400, 'stored message'],
    ['scholarship_unavailable', 400, 'stored message'],
  ] as const)('a %s checkout error is a %i', async (code, status, error) => {
    h.createCheckout.mockRejectedValue(new RegistrationCheckoutError(code, 'stored message'))
    expect(await settle(await post())).toEqual({ status, body: { error, code } })
  })

  it('any other checkout failure is a 502', async () => {
    h.createCheckout.mockRejectedValue(new Error('stripe down'))
    expect(await settle(await post())).toEqual({
      status: 502, body: { error: 'Payment could not be started. Please try again shortly.' },
    })
  })

  it('the route itself writes nothing', async () => {
    await post()
    expect(rec.writes()).toEqual([])
    expect(rec.log).toEqual(['select registrations'])
  })
})
