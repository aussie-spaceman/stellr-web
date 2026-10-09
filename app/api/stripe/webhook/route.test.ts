import { describe, it, expect, vi, beforeEach } from 'vitest'
import type Stripe from 'stripe'

// Fixture-driven tests for the Stripe webhook's money paths (deep review PAY-13).
// Covers the three fixes in this PR:
//   PAY-3 — a dahlia-shaped renewal invoice.paid extends expires_at.
//   PAY-4 — a second checkout.session.completed for one registration is refunded,
//           not re-confirmed, and never overwrites the first payment intent.
//   PAY-6 — a checkout.session.completed with payment_status 'unpaid' fulfils
//           nothing (delayed ACH-style payment not yet cleared).

vi.mock('server-only', () => ({}))

// Spies must be created in a hoisted block: vi.mock factories are hoisted above
// normal top-level consts, and route.ts is imported (and its mock factories run)
// before those consts would initialise.
const h = vi.hoisted(() => ({
  confirmRegistration: vi.fn(async () => {}),
  handleStoreOrderPaid: vi.fn(async () => {}),
  finalizeRegistrationMerch: vi.fn(async () => {}),
  finalizeRedemption: vi.fn(async () => {}),
  notifyCommunityAdmins: vi.fn(async () => {}),
  recordExternalChargeRefunds: vi.fn(async () => ({ recorded: 0 })),
  logActivity: vi.fn(async () => {}),
  fireTierPurchased: vi.fn(async () => {}),
  grantTier: vi.fn(async () => ({})),
  rosterAfterPaidBooking: vi.fn(async () => {}),
  scheduleFromRequest: vi.fn(async () => {}),
  confirmPaidBooking: vi.fn(async () => 'b1'),
  redeemCoupon: vi.fn(async () => {}),
  grantTierAllocations: vi.fn(async () => {}),
  grantPurchasedLot: vi.fn(async () => {}),
  getOfferingTarget: vi.fn(async () => null),
  sendEmail: vi.fn(async () => {}),
  refundsCreate: vi.fn(async () => ({ id: 're_dup' })),
}))

// ── A tiny in-memory Supabase stand-in: enough for select/eq/neq/maybeSingle +
// update(...).eq(...) + insert. Writes mutate the fixture rows in place (so a
// later read sees them) and are recorded for assertions.
type Row = Record<string, unknown>
function makeDb(tables: Record<string, Row[]>) {
  const updates: { table: string; set: Row }[] = []
  const inserts: { table: string; rows: Row[] }[] = []
  function builder(table: string) {
    const filters: ((r: Row) => boolean)[] = []
    let pendingUpdate: Row | null = null
    const matched = () => (tables[table] ??= []).filter((r) => filters.every((f) => f(r)))
    const run = () => {
      if (pendingUpdate) {
        const rows = matched()
        for (const r of rows) Object.assign(r, pendingUpdate)
        updates.push({ table, set: pendingUpdate })
        return { data: rows, error: null }
      }
      return { data: matched(), error: null }
    }
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), q),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
      limit: () => q,
      order: () => q,
      not: () => q,
      maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
      single: async () => ({ data: matched()[0] ?? null, error: null }),
      update: (set: Row) => ((pendingUpdate = set), q),
      insert: (payload: Row | Row[]) => {
        const rows = Array.isArray(payload) ? payload : [payload]
        inserts.push({ table, rows })
        ;(tables[table] ??= []).push(...rows)
        return q
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    }
    return q
  }
  return { db: { from: builder }, updates, inserts }
}

let current: ReturnType<typeof makeDb>
let currentEvent: Stripe.Event

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => current.db }))
vi.mock('@/lib/stripe', () => {
  const stub = {
    webhooks: { constructEvent: () => currentEvent },
    refunds: { create: h.refundsCreate },
  }
  return { requireStripe: () => stub, stripeClient: () => stub, STRIPE_API_VERSION: 'test' }
})
vi.mock('@/lib/registration-confirm', () => ({ confirmRegistration: h.confirmRegistration }))
vi.mock('@/lib/store/orders', () => ({ handleStoreOrderPaid: h.handleStoreOrderPaid }))
vi.mock('@/lib/store/event-merch', () => ({ finalizeRegistrationMerch: h.finalizeRegistrationMerch }))
vi.mock('@/lib/refunds/redeem', () => ({ finalizeRedemption: h.finalizeRedemption }))
vi.mock('@/lib/notify', () => ({ notifyCommunityAdmins: h.notifyCommunityAdmins }))
vi.mock('@/lib/refunds/stripe-webhook', () => ({ recordExternalChargeRefunds: h.recordExternalChargeRefunds }))
vi.mock('@/lib/activity-log', () => ({ logActivity: h.logActivity }))
vi.mock('@/lib/membership-grants', () => ({ fireTierPurchased: h.fireTierPurchased, grantTier: h.grantTier }))
vi.mock('@/lib/mentoring', () => ({ rosterAfterPaidBooking: h.rosterAfterPaidBooking }))
vi.mock('@/lib/coaching-requests', () => ({ scheduleFromRequest: h.scheduleFromRequest }))
vi.mock('@/lib/entitlements', () => ({
  confirmPaidBooking: h.confirmPaidBooking,
  redeemCoupon: h.redeemCoupon,
  grantTierAllocations: h.grantTierAllocations,
  grantPurchasedLot: h.grantPurchasedLot,
  getOfferingTarget: h.getOfferingTarget,
}))
vi.mock('@/lib/email', () => ({
  sendEmail: h.sendEmail,
  individualConfirmationEmail: () => ({ subject: '', html: '', text: '' }),
}))

import { POST } from './route'

function post(event: Stripe.Event) {
  currentEvent = event
  const req = new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 't=1,v1=sig' },
    body: '{}',
  })
  return POST(req as never)
}

async function readRow(table: string, id: string): Promise<Row | null> {
  const b = current.db.from(table) as {
    select: () => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: Row | null }> } }
  }
  return (await b.select().eq('id', id).maybeSingle()).data
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
})

describe('invoice.paid renewal (PAY-3: dahlia subscription shape)', () => {
  it('extends expires_at from parent.subscription_details.subscription', async () => {
    current = makeDb({
      member_memberships: [
        { id: 'mm1', stripe_subscription_id: 'sub_1', renewal_status: 'active', billing_interval: 'monthly', expires_at: '2026-01-01' },
      ],
      stripe_webhook_events: [],
    })
    const periodEnd = Math.floor(Date.parse('2026-12-01T00:00:00Z') / 1000)
    const res = await post({
      id: 'evt_renew', type: 'invoice.paid',
      data: { object: {
        // dahlia: NO top-level `subscription`; it lives under parent.
        metadata: {},
        parent: { subscription_details: { subscription: 'sub_1' } },
        lines: { data: [{ period: { end: periodEnd } }] },
      } },
    } as unknown as Stripe.Event)

    expect(res.status).toBe(200)
    expect(await readRow('member_memberships', 'mm1')).toMatchObject({ expires_at: '2026-12-01' })
  })
})

describe('checkout.session.completed duplicate (PAY-4)', () => {
  const sessionFor = (id: string, pi: string) => ({
    id, payment_status: 'paid', payment_intent: pi,
    metadata: { registrationId: 'r1' }, client_reference_id: 'r1',
    amount_total: 7500, currency: 'usd', customer: null, customer_details: null,
  })

  it('refunds the second payment and keeps the first intent', async () => {
    current = makeDb({
      registrations: [{ id: 'r1', status: 'pending', stripe_payment_intent_id: null }],
      participants: [],
      stripe_webhook_events: [],
    })

    await post({ id: 'evt_a', type: 'checkout.session.completed', data: { object: sessionFor('cs_a', 'pi_1') } } as unknown as Stripe.Event)
    await post({ id: 'evt_b', type: 'checkout.session.completed', data: { object: sessionFor('cs_b', 'pi_2') } } as unknown as Stripe.Event)

    // confirmRegistration ran exactly once (the first payment).
    expect(h.confirmRegistration).toHaveBeenCalledTimes(1)
    // The duplicate (pi_2) was refunded, tagged, idempotency-keyed.
    expect(h.refundsCreate).toHaveBeenCalledTimes(1)
    expect(h.refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_2', metadata: expect.objectContaining({ source: 'stellr_app' }) }),
      expect.objectContaining({ idempotencyKey: 'dup-cs_b' }),
    )
    // The registration still references the FIRST intent.
    expect(await readRow('registrations', 'r1')).toMatchObject({ stripe_payment_intent_id: 'pi_1' })
    expect(h.notifyCommunityAdmins).toHaveBeenCalledTimes(1)
  })
})

describe('checkout.session.completed payment_status gate (PAY-6)', () => {
  it('fulfils nothing when payment_status is unpaid (delayed ACH)', async () => {
    current = makeDb({ registrations: [{ id: 'r1', status: 'pending', stripe_payment_intent_id: null }], stripe_webhook_events: [] })
    const res = await post({
      id: 'evt_unpaid', type: 'checkout.session.completed',
      data: { object: { id: 'cs_u', payment_status: 'unpaid', payment_intent: 'pi_u', metadata: { registrationId: 'r1' }, client_reference_id: 'r1' } },
    } as unknown as Stripe.Event)

    expect(res.status).toBe(200)
    expect(h.confirmRegistration).not.toHaveBeenCalled()
    expect(h.handleStoreOrderPaid).not.toHaveBeenCalled()
    expect(h.finalizeRedemption).not.toHaveBeenCalled()
  })

  it('fulfils a store order once the async payment succeeds', async () => {
    current = makeDb({ stripe_webhook_events: [] })
    await post({
      id: 'evt_async_ok', type: 'checkout.session.async_payment_succeeded',
      data: { object: { id: 'cs_s', payment_status: 'paid', metadata: { type: 'store_order', orderId: 'o1' } } },
    } as unknown as Stripe.Event)
    expect(h.handleStoreOrderPaid).toHaveBeenCalledTimes(1)
  })
})
