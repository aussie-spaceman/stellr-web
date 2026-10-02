import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeDb, type FakeDb } from '@/lib/refunds/fake-db.test-helper'

const { getEventBySlug, assertLiveCredentials, logActivity, stripeRefundState } = vi.hoisted(() => ({
  getEventBySlug: vi.fn(async (_slug: string) => ({ stripePriceId: 'price_fee' })),
  assertLiveCredentials: vi.fn(),
  logActivity: vi.fn(async () => {}),
  stripeRefundState: vi.fn(async (_pi: string): Promise<unknown> => ({ amountCents: 16500, refundedCents: 0, currency: 'usd' })),
}))
vi.mock('@/lib/sanity', () => ({ getEventBySlug }))
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials }))
vi.mock('@/lib/activity-log', () => ({ logActivity }))
vi.mock('@/lib/refunds/stripe-state', async () => {
  const actual = await vi.importActual<typeof import('@/lib/refunds/stripe-state')>('@/lib/refunds/stripe-state')
  return { ...actual, stripeRefundState }
})

import { issueScholarshipRefund, quoteScholarshipRefund } from '@/lib/scholarship-refund'

// ── Fixtures ──────────────────────────────────────────────────────────────────

let current: FakeDb

function seed(reg: Record<string, unknown> = {}, extra: Record<string, Record<string, unknown>[]> = {}) {
  current = fakeDb({
    registrations: [{
      id: 'reg-1', event_slug: 'nevada', event_title: 'Nevada SDC', status: 'confirmed', type: 'individual',
      invoice_requested: false, stripe_payment_intent_id: 'pi_1', ...reg,
    }],
    participants: [{ id: 'p1', registration_id: 'reg-1', member_id: 'm1' }],
    event_refunds: [],
    account_credits: [],
    ...extra,
  })
  return current.db as never
}

/** The fee line as the student paid it: 16500 at full price, 8250 with a 50% code. */
function makeStripe(feeLineCents: number | null = 16500, opts: { refundFails?: boolean; sessionFails?: boolean } = {}) {
  const create = vi.fn(async (_p: unknown, _o?: unknown) => {
    if (opts.refundFails) throw new Error('card_declined')
    return { id: 're_1' }
  })
  const stripe = {
    prices: { retrieve: vi.fn(async () => ({ unit_amount: 16500, currency: 'usd' })) },
    checkout: {
      sessions: {
        list: vi.fn(async () => {
          if (opts.sessionFails) throw new Error('boom')
          return { data: [{ id: 'cs_1' }] }
        }),
        listLineItems: vi.fn(async () => ({
          data: feeLineCents == null ? [] : [
            { price: { id: 'price_fee' }, amount_total: feeLineCents },
            { price: { id: 'price_shirt' }, amount_total: 1500 },
          ],
        })),
      },
    },
    refunds: { create },
  }
  return { stripe: stripe as never, create }
}

const refundRows = () => current.inserts.filter((i) => i.table === 'event_refunds').flatMap((i) => i.rows)
const creditRows = () => current.inserts.filter((i) => i.table === 'account_credits').flatMap((i) => i.rows)
const issue = (stripe: never, method: 'cash' | 'credit' = 'cash', percent = 50) =>
  issueScholarshipRefund(current.db as never, stripe, { applicationId: 'sch-1', registrationId: 'reg-1', percent, method, actorMemberId: 'admin-m' })

beforeEach(() => {
  vi.clearAllMocks()
  stripeRefundState.mockResolvedValue({ amountCents: 18000, refundedCents: 0, currency: 'usd' })
})

// ── Quote ─────────────────────────────────────────────────────────────────────

describe('quoteScholarshipRefund', () => {
  it('refunds the difference between the fee paid and the scholarship price', async () => {
    const db = seed()
    const q = await quoteScholarshipRefund(db, makeStripe(16500).stripe, 'reg-1', 50)
    expect(q).toMatchObject({ status: 'refund', refundCents: 8250, feePaidCents: 16500, targetCents: 8250 })
  })

  it('nets off a discount code already used at checkout — no double refund', async () => {
    const db = seed()
    const q = await quoteScholarshipRefund(db, makeStripe(8250).stripe, 'reg-1', 50)
    expect(q).toMatchObject({ status: 'nothing_due', refundCents: 0 })
  })

  it('a bigger scholarship than the code they used refunds only the extra', async () => {
    const db = seed()
    const q = await quoteScholarshipRefund(db, makeStripe(8250).stripe, 'reg-1', 100)
    expect(q).toMatchObject({ status: 'refund', refundCents: 8250 })
  })

  it('ignores merch add-ons: only the event-fee line counts', async () => {
    const db = seed()
    const q = await quoteScholarshipRefund(db, makeStripe(16500).stripe, 'reg-1', 100)
    expect(q.refundCents).toBe(16500)
  })

  it('is capped by what Stripe says is still refundable', async () => {
    const db = seed()
    stripeRefundState.mockResolvedValue({ amountCents: 16500, refundedCents: 14500, currency: 'usd' })
    const q = await quoteScholarshipRefund(db, makeStripe(16500).stripe, 'reg-1', 50)
    expect(q.refundCents).toBe(2000)
  })

  it('falls back to the charge (capped at one fee) when the checkout cannot be read', async () => {
    const db = seed()
    stripeRefundState.mockResolvedValue({ amountCents: 16500, refundedCents: 0, currency: 'usd' })
    const q = await quoteScholarshipRefund(db, makeStripe(16500, { sessionFails: true }).stripe, 'reg-1', 50)
    expect(q).toMatchObject({ status: 'refund', refundCents: 8250 })
  })

  it.each([
    ['not_paid', { status: 'pending' }],
    ['manual', { invoice_requested: true }],
    ['nothing_due', { stripe_payment_intent_id: null }], // a $0 checkout (100% code) or manual confirmation
  ])('%s for %j', async (status, reg) => {
    const db = seed(reg)
    const q = await quoteScholarshipRefund(db, makeStripe().stripe, 'reg-1', 50)
    expect(q.status).toBe(status)
    expect(q.refundCents).toBe(0)
  })

  it('a Stripe price it cannot read is manual, never "free"', async () => {
    const db = seed()
    const { stripe } = makeStripe()
    ;(stripe as unknown as { prices: { retrieve: () => Promise<never> } }).prices.retrieve = async () => { throw new Error('No such price') }
    const q = await quoteScholarshipRefund(db, stripe, 'reg-1', 50)
    expect(q.status).toBe('manual')
  })

  it('already_done once a scholarship reimbursement exists', async () => {
    const db = seed({}, { event_refunds: [{ registration_id: 'reg-1', kind: 'scholarship', refund_type: 'cash', refund_cents: 8250 }] })
    const q = await quoteScholarshipRefund(db, makeStripe().stripe, 'reg-1', 50)
    expect(q.status).toBe('already_done')
  })
})

// ── Issue ─────────────────────────────────────────────────────────────────────

describe('issueScholarshipRefund', () => {
  it('cash: refunds in Stripe, tagged so the webhook ignores it, idempotent per application, audited as kind=scholarship', async () => {
    seed()
    const { stripe, create } = makeStripe(16500)

    const r = await issue(stripe)

    expect(r).toMatchObject({ type: 'cash', refundCents: 8250, stripeRefundId: 're_1' })
    expect(assertLiveCredentials).toHaveBeenCalledWith('stripe')
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_1', amount: 8250, metadata: expect.objectContaining({ source: 'stellr_app', kind: 'scholarship' }) }),
      { idempotencyKey: 'scholarship-refund-sch-1' },
    )
    expect(refundRows()[0]).toMatchObject({
      kind: 'scholarship', refund_type: 'cash', refund_cents: 8250, refund_pct: 50,
      registration_id: 'reg-1', participant_id: 'p1', member_id: 'm1', stripe_refund_id: 're_1', decided_by: 'admin-m',
    })
  })

  it('credit: adds non-expiring account credit and moves no money', async () => {
    seed()
    const { stripe, create } = makeStripe(16500)

    const r = await issue(stripe, 'credit')

    expect(r).toMatchObject({ type: 'credit', refundCents: 8250 })
    expect(create).not.toHaveBeenCalled()
    expect(creditRows()[0]).toMatchObject({ member_id: 'm1', amount_cents: 8250, remaining_cents: 8250, source_type: 'scholarship', expires_at: null })
    expect(refundRows()[0]).toMatchObject({ kind: 'scholarship', refund_type: 'credit' })
  })

  it('a failed card refund is audited as manual_required and reported, not thrown', async () => {
    seed()
    const r = await issue(makeStripe(16500, { refundFails: true }).stripe)

    expect(r).toMatchObject({ type: 'manual_required', refundCents: 8250 })
    expect(refundRows()[0]).toMatchObject({ kind: 'scholarship', refund_type: 'manual_required' })
  })

  it('paid by invoice: recorded as manual_required so staff see it', async () => {
    seed({ invoice_requested: true })
    const { stripe, create } = makeStripe()

    const r = await issue(stripe)

    expect(r.type).toBe('manual_required')
    expect(create).not.toHaveBeenCalled()
    expect(refundRows()[0]).toMatchObject({ kind: 'scholarship', refund_type: 'manual_required', refund_cents: 0 })
  })

  it('nothing owed: no refund, no audit row', async () => {
    seed()
    const { stripe, create } = makeStripe(8250)

    const r = await issue(stripe)

    expect(r.type).toBe('none')
    expect(create).not.toHaveBeenCalled()
    expect(refundRows()).toHaveLength(0)
  })
})
