import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeDb, type FakeDb } from './fake-db.test-helper'

// What the delete dialog is told about a refund made in the Stripe dashboard.
let current: FakeDb
const stripe = { prices: { retrieve: vi.fn() }, paymentIntents: { retrieve: vi.fn() } }

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => current.db }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => stripe }))
vi.mock('@/lib/sanity', () => ({
  getEventBySlug: async () => ({ stripePriceId: 'price_1' }),
}))

import { previewRefund } from './preview'

const chargeState = (amount: number, refunded: number, paidDaysAgo = 10) => {
  const created = Math.floor((Date.now() - paidDaysAgo * 86_400_000) / 1000)
  return { amount_received: amount, currency: 'usd', created, latest_charge: { amount, amount_refunded: refunded, currency: 'usd', created } }
}

beforeEach(() => {
  current = fakeDb({
    participants: [{ id: 'p1', registration_id: 'r1', individual_payment_status: 'paid', stripe_payment_intent_id: 'pi_1' }],
    registrations: [{ id: 'r1', event_slug: 'colorado', status: 'confirmed', stripe_payment_intent_id: null }],
    event_refunds: [],
  })
  stripe.prices.retrieve.mockResolvedValue({ unit_amount: 10000, currency: 'usd' })
})

describe('previewRefund', () => {
  it('within 45 days of payment: the full amount, as cash', async () => {
    stripe.paymentIntents.retrieve.mockResolvedValue(chargeState(10000, 0, 12))
    const p = await previewRefund('p1')
    expect(p.externalRefund).toBeNull()
    expect(p.daysSincePayment).toBe(12)
    expect(p.guaranteeDays).toBe(45)
    expect(p.options).toEqual({ cash: { pct: 100, cents: 10000 } })
  })

  it('after 45 days: nothing offered, and the dialog is told how long ago', async () => {
    stripe.paymentIntents.retrieve.mockResolvedValue(chargeState(10000, 0, 60))
    const p = await previewRefund('p1')
    expect(p.daysSincePayment).toBe(60)
    expect(p.options).toEqual({})
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
    // 4000 left → all of it.
    expect(p.options).toEqual({ cash: { pct: 100, cents: 4000 } })
  })
})
