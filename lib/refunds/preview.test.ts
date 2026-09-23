import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeDb, type FakeDb } from './fake-db.test-helper'

// What the delete dialog is told about a refund made in the Stripe dashboard.
let current: FakeDb
const stripe = { prices: { retrieve: vi.fn() }, paymentIntents: { retrieve: vi.fn() } }

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => current.db }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => stripe }))
vi.mock('@/lib/sanity', () => ({
  // 40 days out → default tier 30+: 50% cash or 75% credit.
  getEventBySlug: async () => ({ date: new Date(Date.now() + 40.5 * 86_400_000).toISOString(), stripePriceId: 'price_1' }),
}))
vi.mock('./policy', async (orig) => {
  const actual = await orig<typeof import('./policy')>()
  return { ...actual, resolvePolicy: async () => actual.DEFAULT_TIERS }
})

import { previewRefund } from './preview'

const chargeState = (amount: number, refunded: number) => ({
  amount_received: amount, currency: 'usd', latest_charge: { amount, amount_refunded: refunded, currency: 'usd' },
})

beforeEach(() => {
  current = fakeDb({
    participants: [{ id: 'p1', registration_id: 'r1', individual_payment_status: 'paid', stripe_payment_intent_id: 'pi_1' }],
    registrations: [{ id: 'r1', event_slug: 'colorado', status: 'confirmed', stripe_payment_intent_id: null }],
    event_refunds: [],
  })
  stripe.prices.retrieve.mockResolvedValue({ unit_amount: 10000, currency: 'usd' })
})

describe('previewRefund', () => {
  it('nothing refunded in Stripe: the policy options as before', async () => {
    stripe.paymentIntents.retrieve.mockResolvedValue(chargeState(10000, 0))
    const p = await previewRefund('p1')
    expect(p.externalRefund).toBeNull()
    expect(p.options.cash).toMatchObject({ cents: 5000 })
    expect(p.options.credit).toMatchObject({ cents: 7500 })
  })

  it('fully refunded in Stripe: flagged, and nothing offered', async () => {
    stripe.paymentIntents.retrieve.mockResolvedValue(chargeState(10000, 10000))
    const p = await previewRefund('p1')
    expect(p.externalRefund).toEqual({ refundedCents: 10000, currency: 'usd', full: true })
    expect(p.options).toEqual({})
  })

  it('partly refunded in Stripe: options capped at what is left', async () => {
    stripe.paymentIntents.retrieve.mockResolvedValue(chargeState(10000, 6000))
    const p = await previewRefund('p1')
    expect(p.externalRefund).toMatchObject({ refundedCents: 6000, full: false })
    // 4000 left → 50% cash = 2000, 75% credit = 3000.
    expect(p.options.cash).toMatchObject({ cents: 2000 })
    expect(p.options.credit).toMatchObject({ cents: 3000 })
  })
})
