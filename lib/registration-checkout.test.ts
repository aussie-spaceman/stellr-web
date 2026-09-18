import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getEventBySlug, assertLiveCredentials } = vi.hoisted(() => ({
  getEventBySlug: vi.fn(async (_slug: string) => ({ stripePriceId: 'price_fee' } as { stripePriceId?: string })),
  assertLiveCredentials: vi.fn(),
}))
vi.mock('@/lib/sanity', () => ({ getEventBySlug }))
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials }))

import {
  createRegistrationCheckout,
  RegistrationCheckoutError,
  ensurePayToken,
  payPageUrl,
} from '@/lib/registration-checkout'

// ── Stubs ─────────────────────────────────────────────────────────────────────

interface Reg {
  id?: string
  type: 'individual' | 'group' | 'campaign'
  status: 'pending' | 'confirmed' | 'withdrawn'
  invoice_requested?: boolean
  member_pays_individually?: boolean
  adult_count?: number | null
  student_count?: number | null
  teacher_first_name?: string | null
  teacher_last_name?: string | null
  teacher_email?: string | null
  pay_token?: string | null
}

function makeDb(opts: {
  registration: Reg | null
  participant?: { first_name: string; last_name: string; email: string } | null
  participantCount?: number
  addons?: { name: string; qty: number; unit_amount_cents: number }[]
}) {
  const updates: Record<string, unknown>[] = []
  let regState = opts.registration ? { id: 'reg-1', event_slug: 'nevada-2027', event_title: 'Nevada 2027', ...opts.registration } : null
  const db = {
    from(table: string) {
      if (table === 'registrations') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          update: (payload: Record<string, unknown>) => {
            updates.push(payload)
            if (regState && regState.pay_token == null) regState = { ...regState, ...payload }
            return chain
          },
          maybeSingle: async () => ({ data: regState, error: null }),
        }
        return chain
      }
      if (table === 'participants') {
        const chain = {
          select: (_cols: string, o?: { count?: string; head?: boolean }) => {
            if (o?.head) {
              const countChain = { eq: async () => ({ count: opts.participantCount ?? 0, error: null }) }
              return countChain
            }
            return chain
          },
          eq: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: opts.participant ?? null, error: null }),
        }
        return chain
      }
      if (table === 'store_orders') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: opts.addons?.length ? { id: 'order-1' } : null, error: null }),
        }
        return chain
      }
      if (table === 'store_order_items') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          then: (resolve: (v: { data: unknown; error: null }) => void) =>
            resolve({ data: opts.addons ?? [], error: null }),
        }
        return chain
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return { db: db as never, updates }
}

function makeStripe(unitAmount: number | null = 7500) {
  const create = vi.fn(async (_p: unknown) => ({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' }))
  const retrieve = vi.fn(async (_id: string) => ({ unit_amount: unitAmount }))
  return { stripe: { checkout: { sessions: { create } }, prices: { retrieve } } as never, create, retrieve }
}

const URLS = { successUrl: 'https://www.stellreducation.org/ok', cancelUrl: 'https://www.stellreducation.org/cancel' }

beforeEach(() => {
  vi.clearAllMocks()
  getEventBySlug.mockResolvedValue({ stripePriceId: 'price_fee' })
})

// ── createRegistrationCheckout ────────────────────────────────────────────────

describe('createRegistrationCheckout — individual', () => {
  it('builds the fee line with the webhook-compatible metadata and the participant email', async () => {
    const { db } = makeDb({
      registration: { type: 'individual', status: 'pending' },
      participant: { first_name: 'Daniel', last_name: 'Ahaiwe', email: 'dan@example.com' },
    })
    const { stripe, create } = makeStripe(7500)

    const result = await createRegistrationCheckout(db, stripe, 'reg-1', URLS)

    expect(result).toEqual({ url: 'https://checkout.stripe.test/cs_1', sessionId: 'cs_1', amountCents: 7500 })
    expect(assertLiveCredentials).toHaveBeenCalledWith('stripe')
    const params = create.mock.calls[0][0] as Record<string, unknown>
    expect(params).toMatchObject({
      mode: 'payment',
      allow_promotion_codes: true,
      client_reference_id: 'reg-1',
      customer_email: 'dan@example.com',
      customer_creation: 'always',
      line_items: [{ price: 'price_fee', quantity: 1 }],
      metadata: { registrationId: 'reg-1', eventSlug: 'nevada-2027', participantName: 'Daniel Ahaiwe' },
      success_url: URLS.successUrl,
      cancel_url: URLS.cancelUrl,
    })
    expect(params.metadata).not.toHaveProperty('isGroup')
  })

  it('adds pending merch add-ons as price_data lines', async () => {
    const { db } = makeDb({
      registration: { type: 'individual', status: 'pending' },
      participant: { first_name: 'D', last_name: 'A', email: 'dan@example.com' },
      addons: [{ name: 'Event shirt — L', qty: 2, unit_amount_cents: 1500 }],
    })
    const { stripe, create } = makeStripe(7500)

    const result = await createRegistrationCheckout(db, stripe, 'reg-1', URLS)

    expect(result.amountCents).toBe(7500 + 3000)
    const params = create.mock.calls[0][0] as { line_items: unknown[] }
    expect(params.line_items).toEqual([
      { price: 'price_fee', quantity: 1 },
      { quantity: 2, price_data: { currency: 'usd', unit_amount: 1500, product_data: { name: 'Event shirt — L' } } },
    ])
  })

  it('omits customer_email when the caller passes null (parent paying for a child)', async () => {
    const { db } = makeDb({
      registration: { type: 'individual', status: 'pending' },
      participant: { first_name: 'D', last_name: 'A', email: 'dan@example.com' },
    })
    const { stripe, create } = makeStripe()

    await createRegistrationCheckout(db, stripe, 'reg-1', { ...URLS, customerEmail: null })

    expect(create.mock.calls[0][0]).not.toHaveProperty('customer_email')
  })

  it('uses the event the caller already holds instead of refetching', async () => {
    const { db } = makeDb({
      registration: { type: 'individual', status: 'pending' },
      participant: { first_name: 'D', last_name: 'A', email: 'dan@example.com' },
    })
    const { stripe, retrieve } = makeStripe()

    await createRegistrationCheckout(db, stripe, 'reg-1', { ...URLS, event: { stripePriceId: 'price_other' } })

    expect(getEventBySlug).not.toHaveBeenCalled()
    expect(retrieve).toHaveBeenCalledWith('price_other')
  })

  it('throws nothing_to_pay for a free event with no add-ons', async () => {
    const { db } = makeDb({
      registration: { type: 'individual', status: 'pending' },
      participant: { first_name: 'D', last_name: 'A', email: 'dan@example.com' },
    })
    const { stripe, create } = makeStripe(0)

    await expect(createRegistrationCheckout(db, stripe, 'reg-1', URLS)).rejects.toMatchObject({ code: 'nothing_to_pay' })
    expect(create).not.toHaveBeenCalled()
  })
})

describe('createRegistrationCheckout — group', () => {
  it('charges the declared seat count with isGroup metadata and the organiser email', async () => {
    const { db } = makeDb({
      registration: {
        type: 'group', status: 'pending', adult_count: 1, student_count: 4,
        teacher_first_name: 'Ms', teacher_last_name: 'Frizzle', teacher_email: 'frizzle@school.org',
      },
    })
    const { stripe, create } = makeStripe(7500)

    const result = await createRegistrationCheckout(db, stripe, 'reg-1', URLS)

    expect(result.amountCents).toBe(7500 * 5)
    expect(create.mock.calls[0][0]).toMatchObject({
      customer_email: 'frizzle@school.org',
      line_items: [{ price: 'price_fee', quantity: 5 }],
      metadata: { registrationId: 'reg-1', eventSlug: 'nevada-2027', isGroup: 'true', teacherName: 'Ms Frizzle' },
    })
  })

  it('falls back to the roster count for pre-037 rows with no declared size', async () => {
    const { db } = makeDb({
      registration: { type: 'group', status: 'pending', adult_count: null, student_count: null, teacher_email: 't@x.org' },
      participantCount: 3,
    })
    const { stripe, create } = makeStripe(1000)

    await createRegistrationCheckout(db, stripe, 'reg-1', URLS)

    expect(create.mock.calls[0][0]).toMatchObject({ line_items: [{ price: 'price_fee', quantity: 3 }] })
  })

  it('throws no_price when the event has no Stripe price', async () => {
    const { db } = makeDb({ registration: { type: 'group', status: 'pending', adult_count: 1, student_count: 2 } })
    const { stripe } = makeStripe()
    getEventBySlug.mockResolvedValue({})

    await expect(createRegistrationCheckout(db, stripe, 'reg-1', URLS)).rejects.toMatchObject({ code: 'no_price' })
  })
})

describe('createRegistrationCheckout — guards', () => {
  it.each([
    ['not_found', null],
    ['not_pending', { type: 'individual', status: 'confirmed' }],
    ['not_pending', { type: 'individual', status: 'withdrawn' }],
    ['not_card', { type: 'group', status: 'pending', invoice_requested: true }],
    ['not_card', { type: 'group', status: 'pending', member_pays_individually: true }],
  ] as [string, Reg | null][])('throws %s', async (code, registration) => {
    const { db } = makeDb({ registration })
    const { stripe, create } = makeStripe()

    const err = await createRegistrationCheckout(db, stripe, 'reg-1', URLS).catch((e) => e)
    expect(err).toBeInstanceOf(RegistrationCheckoutError)
    expect(err.code).toBe(code)
    expect(create).not.toHaveBeenCalled()
  })
})

// ── ensurePayToken / payPageUrl ───────────────────────────────────────────────

describe('ensurePayToken', () => {
  it('returns the existing token without writing', async () => {
    const { db, updates } = makeDb({ registration: { type: 'individual', status: 'pending', pay_token: 'a'.repeat(64) } })
    expect(await ensurePayToken(db, 'reg-1')).toBe('a'.repeat(64))
    expect(updates).toHaveLength(0)
  })

  it('mints a 64-hex token for a row that has none', async () => {
    const { db, updates } = makeDb({ registration: { type: 'individual', status: 'pending', pay_token: null } })
    const token = await ensurePayToken(db, 'reg-1')
    expect(token).toMatch(/^[a-f0-9]{64}$/)
    expect(updates).toEqual([{ pay_token: token }])
  })
})

describe('payPageUrl', () => {
  it('points at the public pay page, with the cancelled flag on request', () => {
    expect(payPageUrl('nevada-2027', 'abc')).toMatch(/\/register\/nevada-2027\/pay\/abc$/)
    expect(payPageUrl('nevada-2027', 'abc', { cancelled: true })).toMatch(/\/pay\/abc\?cancelled=1$/)
  })
})
