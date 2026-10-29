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
  creditNotes: { create: vi.fn(async () => ({ id: 'cn_1' })) },
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => current.db }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => stripe }))
vi.mock('@/lib/sanity', () => ({
  getEventBySlug: async () => ({ stripePriceId: 'price_1' }),
}))
vi.mock('@/lib/notify', () => ({ notifyMember: vi.fn(async () => {}), notifyCommunityAdmins: vi.fn(async () => {}) }))
vi.mock('@/lib/activity-log', () => ({ logActivity: vi.fn(async () => {}) }))
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: () => {} }))

import { executeRefund } from './execute'
import { notifyMember } from '@/lib/notify'

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

// 29 Oct 2026: a place on a group invoice. The refund is what the place cost
// after the group's discount (not the list price), it gets a credit note on the
// invoice, and the organiser who paid is told, not the student.
describe('executeRefund — a place on a paid group invoice', () => {
  it('refunds the discounted per-place amount, adds a credit note and tells the organiser', async () => {
    seed({
      participants: [{
        id: 'p2', registration_id: 'r2', email: 'student@example.com', first_name: 'Sam', last_name: 'S',
        member_id: 'm-student', individual_payment_status: null, stripe_payment_intent_id: null,
      }],
      registrations: [{
        id: 'r2', type: 'group', event_slug: 'mn-edc', event_title: 'Minnesota EDC', status: 'confirmed',
        invoice_requested: true, invoice_paid_at: '2026-10-29T00:00:00Z', member_pays_individually: false,
        stripe_payment_intent_id: 'pi_grp', teacher_member_id: 'm-teacher', checkout_session_id: null,
      }],
      group_invoices: [{ stripe_invoice_id: 'in_grp', payment_intent_id: 'pi_grp', total_cents: 148_410, seats: 18, currency: 'usd', kind: 'seats' }],
    })
    stripe.prices.retrieve.mockResolvedValue({ unit_amount: 9700, currency: 'usd' })
    stripe.paymentIntents.retrieve.mockResolvedValue(charge(148_410, 0, 5))

    const r = await executeRefund('p2', 'cash', 'm-teacher', 'Removed by the group organiser', { actorType: 'member' })

    expect(r).toMatchObject({ type: 'cash', refundCents: 8245 })
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_grp', amount: 8245, metadata: { source: 'stellr_app', participant_id: 'p2' } }),
      { idempotencyKey: 'cancel-refund-p2' },
    )
    expect(stripe.creditNotes.create).toHaveBeenCalledWith(expect.objectContaining({
      invoice: 'in_grp', refunds: [{ refund: 're_app', amount_refunded: 8245 }],
    }))
    expect(notifyMember).toHaveBeenCalledWith('m-teacher', expect.objectContaining({ body: expect.stringMatching(/your group's payment for Sam S/) }))
    expect(notifyMember).not.toHaveBeenCalledWith('m-student', expect.anything())
  })
})
