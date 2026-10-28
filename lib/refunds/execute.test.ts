import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeDb, type FakeDb } from './fake-db.test-helper'

// executeRefund, around the 23 Sept 2026 incident: a Colorado registration was
// refunded in full by hand in Stripe, and deleting it would have issued a
// second refund. These pin that a Stripe-side refund is detected, that "No
// refund — remove only" issues nothing, the money-back guarantee's 45 days
// (27 Oct 2026), and the smaller fixes that came with them.

let current: FakeDb
const stripe = {
  prices: { retrieve: vi.fn() },
  paymentIntents: { retrieve: vi.fn() },
  refunds: { create: vi.fn() },
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => current.db }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => stripe }))
vi.mock('@/lib/sanity', () => ({
  getEventBySlug: async () => ({ stripePriceId: 'price_1' }),
}))
vi.mock('@/lib/notify', () => ({ notifyMember: vi.fn(async () => {}) }))
vi.mock('@/lib/activity-log', () => ({ logActivity: vi.fn(async () => {}) }))
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: () => {} }))

import { executeRefund } from './execute'

function seed(extra: Record<string, Record<string, unknown>[]> = {}) {
  current = fakeDb({
    participants: [{
      id: 'p1', registration_id: 'r1', email: 'daksha@example.com', first_name: 'Daksha', last_name: 'R',
      member_id: 'm1', individual_payment_status: 'paid', stripe_payment_intent_id: 'pi_1',
    }],
    registrations: [{ id: 'r1', event_slug: 'colorado', event_title: 'Colorado', status: 'confirmed', stripe_payment_intent_id: null }],
    event_refunds: [],
    members: [],
    ...extra,
  })
}

// `paidDaysAgo` places the charge relative to now: the guarantee runs 45 days.
const charge = (amount: number, refunded: number, paidDaysAgo = 10) => {
  const created = Math.floor((Date.now() - paidDaysAgo * 86_400_000) / 1000)
  return {
    amount_received: amount,
    currency: 'usd',
    created,
    latest_charge: { amount, amount_refunded: refunded, currency: 'usd', created },
  }
}

const refundRows = () => current.inserts.filter((i) => i.table === 'event_refunds').flatMap((i) => i.rows)

beforeEach(() => {
  vi.clearAllMocks()
  stripe.prices.retrieve.mockResolvedValue({ unit_amount: 7500, currency: 'usd' })
  stripe.paymentIntents.retrieve.mockResolvedValue(charge(7500, 0))
  stripe.refunds.create.mockResolvedValue({ id: 're_app' })
})

describe('executeRefund — the money-back guarantee', () => {
  it('refunds everything paid within 45 days, even after the event', async () => {
    seed()
    stripe.paymentIntents.retrieve.mockResolvedValue(charge(7500, 0, 44))

    const r = await executeRefund('p1', 'cash', 'admin-1')

    expect(r).toMatchObject({ type: 'cash', refundCents: 7500 })
    expect(stripe.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 7500 }), expect.anything())
    expect(refundRows()[0]).toMatchObject({ refund_type: 'cash', refund_pct: 100, refund_cents: 7500, days_out: null })
  })

  it('refunds nothing after 45 days, and records why', async () => {
    seed()
    stripe.paymentIntents.retrieve.mockResolvedValue(charge(7500, 0, 50))

    const r = await executeRefund('p1', 'cash', 'admin-1')

    expect(r).toMatchObject({ type: 'none', refundCents: 0 })
    expect(r.detail).toContain('outside the 45-day money-back guarantee')
    expect(stripe.refunds.create).not.toHaveBeenCalled()
    expect(refundRows()[0]).toMatchObject({ refund_type: 'none', note: expect.stringContaining('Paid 50 days ago') })
  })

  it('needs a person when Stripe cannot say when the payment was taken', async () => {
    seed()
    stripe.paymentIntents.retrieve.mockRejectedValue(new Error('No such payment_intent'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const r = await executeRefund('p1', 'cash', 'admin-1')

    expect(r.type).toBe('manual_required')
    expect(stripe.refunds.create).not.toHaveBeenCalled()
  })
})

describe('executeRefund — refunded outside the app, in Stripe', () => {
  it('a full Stripe refund issues nothing further and records it as external', async () => {
    seed()
    stripe.paymentIntents.retrieve.mockResolvedValue(charge(7500, 7500))

    const r = await executeRefund('p1', 'cash', 'admin-1')

    expect(r).toMatchObject({ type: 'none', external: true })
    expect(stripe.refunds.create).not.toHaveBeenCalled()
    expect(refundRows()).toEqual([
      expect.objectContaining({ refund_type: 'none', source: 'stripe_external', refund_cents: 0, note: expect.stringContaining('75.00 USD in Stripe') }),
    ])
  })

  it('keeps the admin reason alongside the Stripe detail', async () => {
    seed()
    stripe.paymentIntents.retrieve.mockResolvedValue(charge(7500, 7500))

    await executeRefund('p1', 'none', 'admin-1', 'Special circumstances')

    expect(refundRows()[0].note).toBe('Refunded 75.00 USD in Stripe outside the app — Special circumstances')
  })

  it('a partial Stripe refund caps what is left to give back', async () => {
    seed()
    // 7000 of 7500 already refunded → 500 left.
    stripe.paymentIntents.retrieve.mockResolvedValue(charge(7500, 7000))

    const r = await executeRefund('p1', 'cash', 'admin-1')

    expect(r).toMatchObject({ type: 'cash', refundCents: 500 })
  })
})

describe("executeRefund — 'none' (No refund — remove only)", () => {
  it('audits the decision with its reason and moves no money', async () => {
    seed()

    const r = await executeRefund('p1', 'none', 'admin-1', 'Refunded in full in Stripe')

    expect(r).toMatchObject({ type: 'none', refundCents: 0 })
    expect(stripe.refunds.create).not.toHaveBeenCalled()
    expect(refundRows()).toEqual([
      expect.objectContaining({
        refund_type: 'none', source: 'admin', note: 'Refunded in full in Stripe', paid_cents: 7500, decided_by: 'admin-1',
      }),
    ])
  })
})

describe('executeRefund — fixes that came with it', () => {
  it('two earlier refund rows still read as already refunded', async () => {
    seed({
      event_refunds: [
        { id: 'e1', participant_id: 'p1', refund_type: 'cash', kind: 'cancellation' },
        { id: 'e2', participant_id: 'p1', refund_type: 'credit', kind: 'cancellation' },
      ],
    })

    const r = await executeRefund('p1', 'cash', 'admin-1')

    expect(r).toMatchObject({ type: 'none', detail: 'Already refunded' })
    expect(stripe.refunds.create).not.toHaveBeenCalled()
  })

  it('a scholarship reimbursement does not count as already refunded on cancellation', async () => {
    seed({
      event_refunds: [{ id: 'e1', participant_id: 'p1', refund_type: 'cash', kind: 'scholarship' }],
    })

    const r = await executeRefund('p1', 'cash', 'admin-1')

    expect(r.detail).not.toBe('Already refunded')
  })

  it("tags the app's own Stripe refunds so the webhook can skip them", async () => {
    seed()

    const r = await executeRefund('p1', 'cash', 'admin-1')

    expect(r).toMatchObject({ type: 'cash', refundCents: 7500 })
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ source: 'stellr_app' }) }),
      expect.objectContaining({ idempotencyKey: 'cancel-refund-p1' }),
    )
  })

  // deep review PAY-12: a stable idempotency key makes a retried or double-
  // submitted cancellation refund a no-op at Stripe, closing the read-then-act
  // window. The DB unique index is the backstop.
  it('passes a per-participant idempotency key on the cancellation refund', async () => {
    seed()

    await executeRefund('p1', 'cash', 'admin-1')

    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_1' }),
      expect.objectContaining({ idempotencyKey: 'cancel-refund-p1' }),
    )
  })
})
