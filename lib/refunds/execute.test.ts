import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeDb, type FakeDb } from './fake-db.test-helper'

// executeRefund, around the 23 Sept 2026 incident: a Colorado registration was
// refunded in full by hand in Stripe, and deleting it would have issued a
// second refund. These pin that a Stripe-side refund is detected, that "No
// refund — remove only" issues nothing, and the smaller fixes that came with it.

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
  // 9 days out → default tier 0+: 25% credit only.
  getEventBySlug: async () => ({ date: new Date(Date.now() + 9.5 * 86_400_000).toISOString(), stripePriceId: 'price_1' }),
}))
vi.mock('@/lib/notify', () => ({ notifyMember: vi.fn(async () => {}) }))
vi.mock('@/lib/activity-log', () => ({ logActivity: vi.fn(async () => {}) }))
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: () => {} }))
vi.mock('./policy', async (orig) => {
  const actual = await orig<typeof import('./policy')>()
  return { ...actual, resolvePolicy: async () => actual.DEFAULT_TIERS }
})

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

const charge = (amount: number, refunded: number) => ({
  amount_received: amount,
  currency: 'usd',
  latest_charge: { amount, amount_refunded: refunded, currency: 'usd' },
})

const refundRows = () => current.inserts.filter((i) => i.table === 'event_refunds').flatMap((i) => i.rows)
const creditRows = () => current.inserts.filter((i) => i.table === 'account_credits').flatMap((i) => i.rows)

beforeEach(() => {
  vi.clearAllMocks()
  stripe.prices.retrieve.mockResolvedValue({ unit_amount: 7500, currency: 'usd' })
  stripe.paymentIntents.retrieve.mockResolvedValue(charge(7500, 0))
  stripe.refunds.create.mockResolvedValue({ id: 're_app' })
})

describe('executeRefund — refunded outside the app, in Stripe', () => {
  it('a full Stripe refund issues nothing further and records it as external', async () => {
    seed()
    stripe.paymentIntents.retrieve.mockResolvedValue(charge(7500, 7500))

    const r = await executeRefund('p1', 'credit', 'admin-1')

    expect(r).toMatchObject({ type: 'none', external: true })
    expect(creditRows()).toHaveLength(0)
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
    // 7000 of 7500 already refunded → 500 left; 25% credit of 500 = 125.
    stripe.paymentIntents.retrieve.mockResolvedValue(charge(7500, 7000))

    const r = await executeRefund('p1', 'credit', 'admin-1')

    expect(r).toMatchObject({ type: 'credit', refundCents: 125 })
    expect(creditRows()[0]).toMatchObject({ amount_cents: 125 })
  })

  it('falls back to the database when Stripe cannot be asked', async () => {
    seed()
    stripe.paymentIntents.retrieve.mockRejectedValue(new Error('No such payment_intent'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const r = await executeRefund('p1', 'credit', 'admin-1')

    expect(r).toMatchObject({ type: 'credit', refundCents: 1875 })
  })
})

describe("executeRefund — 'none' (No refund — remove only)", () => {
  it('audits the decision with its reason and moves no money', async () => {
    seed()

    const r = await executeRefund('p1', 'none', 'admin-1', 'Refunded in full in Stripe')

    expect(r).toMatchObject({ type: 'none', refundCents: 0 })
    expect(stripe.refunds.create).not.toHaveBeenCalled()
    expect(creditRows()).toHaveLength(0)
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
        { id: 'e1', participant_id: 'p1', refund_type: 'cash' },
        { id: 'e2', participant_id: 'p1', refund_type: 'credit' },
      ],
    })

    const r = await executeRefund('p1', 'credit', 'admin-1')

    expect(r).toMatchObject({ type: 'none', detail: 'Already refunded' })
    expect(creditRows()).toHaveLength(0)
  })

  it('a failed credit insert is reported as manual_required, not as issued', async () => {
    seed()
    current.failInsert('account_credits', 'insert denied')

    const r = await executeRefund('p1', 'credit', 'admin-1')

    expect(r.type).toBe('manual_required')
    expect(r.detail).toContain('insert denied')
    expect(refundRows()[0]).toMatchObject({ refund_type: 'manual_required' })
  })

  it("tags the app's own Stripe refunds so the webhook can skip them", async () => {
    seed()
    // 120 days out → 100% cash.
    const sanity = await import('@/lib/sanity')
    vi.spyOn(sanity, 'getEventBySlug').mockResolvedValueOnce({ date: new Date(Date.now() + 120.5 * 86_400_000).toISOString(), stripePriceId: 'price_1' } as never)

    const r = await executeRefund('p1', 'cash', 'admin-1')

    expect(r).toMatchObject({ type: 'cash', refundCents: 7500 })
    expect(stripe.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ source: 'stellr_app' }) }))
  })
})
