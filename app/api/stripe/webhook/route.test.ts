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
  // deep review PAY-N4: cancel the prior Stripe subscription when a new one activates.
  subscriptionsCancel: vi.fn(async () => ({ id: 'sub_cancelled' })),
  // deep review PAY-15: a no-op spy standing in for the test-key guard, so a test
  // can prove the money paths call it (the real guard only throws on a prod
  // deployment holding sandbox keys, which the test env is not).
  assertLiveCredentials: vi.fn(),
}))

// ── A tiny in-memory Supabase stand-in: enough for select/eq/neq/maybeSingle +
// update(...).eq(...) + insert. Writes mutate the fixture rows in place (so a
// later read sees them) and are recorded for assertions.
type Row = Record<string, unknown>
// `opts.failUpdate(table)` → that table's update() resolves with a Supabase
// {error} (deep review PAY-5), letting a test prove a money-path write failure
// aborts the webhook instead of being swallowed. Default (omitted) keeps every
// write succeeding, so existing tests are unaffected.
function makeDb(tables: Record<string, Row[]>, opts?: { failUpdate?: (table: string) => boolean }) {
  const updates: { table: string; set: Row }[] = []
  const inserts: { table: string; rows: Row[] }[] = []
  function builder(table: string) {
    const filters: ((r: Row) => boolean)[] = []
    let pendingUpdate: Row | null = null
    const matched = () => (tables[table] ??= []).filter((r) => filters.every((f) => f(r)))
    const run = () => {
      if (pendingUpdate) {
        if (opts?.failUpdate?.(table)) {
          return { data: null, error: { message: `simulated ${table} write failure` } }
        }
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
      // Minimal PostgREST `.or('col.is.null,col.eq.val')` support for
      // markIndividualPayment's "is the whole group settled?" check (PAY-7 path).
      or: (expr: string) => {
        const clauses = expr.split(',').map((part) => {
          const [col, op, ...rest] = part.split('.')
          const val = rest.join('.')
          return (r: Row) => (op === 'is' && val === 'null' ? r[col] == null : String(r[col]) === val)
        })
        filters.push((r) => clauses.some((c) => c(r)))
        return q
      },
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
    subscriptions: { cancel: h.subscriptionsCancel },
  }
  return { requireStripe: () => stub, stripeClient: () => stub, STRIPE_API_VERSION: 'test' }
})
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: h.assertLiveCredentials }))
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
    // deep review PAY-15: the auto-refund path must consult the test-key guard.
    expect(h.assertLiveCredentials).toHaveBeenCalledWith('stripe')
  })
})

describe('membership activation cancels a stranded prior subscription (PAY-N4)', () => {
  const membershipSession = (subscription: string) => ({
    id: 'cs_m', payment_status: 'paid', subscription,
    metadata: { type: 'membership', memberId: 'm1', tierId: 't_new', billingInterval: 'annual' },
    amount_total: 9900, currency: 'usd', customer: null, customer_details: null,
  })

  it('cancels the prior Stripe subscription, never the new one', async () => {
    current = makeDb({
      // The member already holds an active subscription on a DIFFERENT Stripe sub.
      member_memberships: [
        { id: 'mm_old', member_id: 'm1', tier_id: 't_old', renewal_status: 'active', stripe_subscription_id: 'sub_old' },
      ],
      membership_tiers: [{ id: 't_new', name: 'Innovator' }],
      stripe_webhook_events: [],
    })
    const res = await post({ id: 'evt_m', type: 'checkout.session.completed', data: { object: membershipSession('sub_new') } } as unknown as Stripe.Event)

    expect(res.status).toBe(200)
    // The stranded prior subscription was cancelled so Stripe stops billing it.
    expect(h.subscriptionsCancel).toHaveBeenCalledWith('sub_old')
    // The subscription we just activated is NEVER cancelled.
    expect(h.subscriptionsCancel).not.toHaveBeenCalledWith('sub_new')
    // The old DB row was expired and a new active row inserted.
    expect(await readRow('member_memberships', 'mm_old')).toMatchObject({ renewal_status: 'expired' })
    expect(current.inserts.some((i) => i.table === 'member_memberships')).toBe(true)
  })

  it('does not cancel anything when there is no prior subscription', async () => {
    current = makeDb({
      member_memberships: [],
      membership_tiers: [{ id: 't_new', name: 'Innovator' }],
      stripe_webhook_events: [],
    })
    await post({ id: 'evt_m2', type: 'checkout.session.completed', data: { object: membershipSession('sub_new') } } as unknown as Stripe.Event)
    expect(h.subscriptionsCancel).not.toHaveBeenCalled()
  })
})

describe('members-pay-individually seat settlement (PAY-7 / PAY-N1)', () => {
  // participants.email is the frozen registration-time address; the member signed
  // in / pays under a different (Clerk) address carried as participantEmail. The
  // seat must still be settled, by participant id.
  const seatRows = (intent: string | null = null, status = 'pending') => ({
    participants: [{
      id: 'pX', registration_id: 'r1', email: 'old@school.org',
      individual_payment_status: status, stripe_payment_intent_id: intent,
      first_name: 'Ada', last_name: 'L', membership_id: 'M1',
    }],
    registrations: [{ id: 'r1', status: 'pending', event_title: 'Nevada 2027' }],
    stripe_webhook_events: [],
  })
  const seatSession = (id: string, pi: string, extra: Record<string, unknown> = {}) => ({
    id, payment_status: 'paid', payment_intent: pi,
    metadata: { registrationId: 'r1', participantId: 'pX', participantEmail: 'new@home.com', isIndividualGroupPayment: 'true', ...extra },
    customer: null, customer_details: null, amount_total: 7500, currency: 'usd',
  })

  it('settles the seat by participant id, not by the mismatched email (PAY-7)', async () => {
    current = makeDb(seatRows())
    const res = await post({ id: 'evt_seat', type: 'checkout.session.completed', data: { object: seatSession('cs_seat', 'pi_1') } } as unknown as Stripe.Event)

    expect(res.status).toBe(200)
    const seat = await readRow('participants', 'pX')
    expect(seat).toMatchObject({ individual_payment_status: 'paid', stripe_payment_intent_id: 'pi_1' })
    // Whole group now settled → registration confirmed.
    expect(h.confirmRegistration).not.toHaveBeenCalled() // per-seat path confirms via direct update, not confirmRegistration
    expect(await readRow('registrations', 'r1')).toMatchObject({ status: 'confirmed' })
  })

  it('still settles by email for a pre-PAY-7 session that carries no participantId', async () => {
    current = makeDb({
      participants: [{
        id: 'pX', registration_id: 'r1', email: 'old@school.org',
        individual_payment_status: 'pending', stripe_payment_intent_id: null,
        first_name: 'Ada', last_name: 'L', membership_id: 'M1',
      }],
      registrations: [{ id: 'r1', status: 'pending', event_title: 'Nevada 2027' }],
      stripe_webhook_events: [],
    })
    const session = { id: 'cs_old', payment_status: 'paid', payment_intent: 'pi_1',
      metadata: { registrationId: 'r1', participantEmail: 'old@school.org', isIndividualGroupPayment: 'true' },
      customer: null, customer_details: null, amount_total: 7500, currency: 'usd' }
    await post({ id: 'evt_old', type: 'checkout.session.completed', data: { object: session } } as unknown as Stripe.Event)

    expect(await readRow('participants', 'pX')).toMatchObject({ individual_payment_status: 'paid', stripe_payment_intent_id: 'pi_1' })
  })

  it('refunds a duplicate seat payment and keeps the first intent (PAY-N1)', async () => {
    // The seat already paid under pi_1; a second live session (pi_2) now completes.
    current = makeDb(seatRows('pi_1', 'paid'))
    const res = await post({ id: 'evt_dup_seat', type: 'checkout.session.completed', data: { object: seatSession('cs_seat2', 'pi_2') } } as unknown as Stripe.Event)

    expect(res.status).toBe(200)
    expect(h.refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_2', metadata: expect.objectContaining({ source: 'stellr_app' }) }),
      expect.objectContaining({ idempotencyKey: 'dup-cs_seat2' }),
    )
    // The seat still references the FIRST intent — the duplicate never overwrote it.
    expect(await readRow('participants', 'pX')).toMatchObject({ stripe_payment_intent_id: 'pi_1' })
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

describe('invoice.paid zero-amount guard (PAY-1)', () => {
  it('does NOT confirm an event registration on a $0 invoice', async () => {
    current = makeDb({ registrations: [{ id: 'r1', status: 'pending' }], stripe_webhook_events: [] })
    const res = await post({
      id: 'evt_zero', type: 'invoice.paid',
      // The group invoice-ordering bug could finalise an empty $0 invoice that
      // Stripe auto-marks paid; amount_paid is then 0.
      data: { object: { id: 'in_zero', amount_paid: 0, metadata: { registrationId: 'r1' } } },
    } as unknown as Stripe.Event)

    expect(res.status).toBe(200)
    expect(h.confirmRegistration).not.toHaveBeenCalled()
  })

  it('confirms when the invoice genuinely paid (amount_paid > 0)', async () => {
    current = makeDb({ registrations: [{ id: 'r1', status: 'pending' }], stripe_webhook_events: [] })
    await post({
      id: 'evt_paid', type: 'invoice.paid',
      data: { object: { id: 'in_paid', amount_paid: 40500, metadata: { registrationId: 'r1' } } },
    } as unknown as Stripe.Event)

    expect(h.confirmRegistration).toHaveBeenCalledTimes(1)
    expect(h.confirmRegistration).toHaveBeenCalledWith('r1', false, { paidViaInvoice: true })
  })
})

describe('money-path write failure fails closed (PAY-5)', () => {
  const recorded = () => current.inserts.find((i) => i.table === 'stripe_webhook_events')

  it('a renewal expires_at write error returns 500 and does NOT record the event', async () => {
    current = makeDb(
      {
        member_memberships: [
          { id: 'mm1', stripe_subscription_id: 'sub_1', renewal_status: 'active', billing_interval: 'monthly', expires_at: '2026-01-01' },
        ],
        stripe_webhook_events: [],
      },
      { failUpdate: (t) => t === 'member_memberships' },
    )
    const periodEnd = Math.floor(Date.parse('2026-12-01T00:00:00Z') / 1000)
    const res = await post({
      id: 'evt_renew_err', type: 'invoice.paid',
      data: { object: {
        metadata: {},
        parent: { subscription_details: { subscription: 'sub_1' } },
        lines: { data: [{ period: { end: periodEnd } }] },
      } },
    } as unknown as Stripe.Event)

    expect(res.status).toBe(500)
    expect(recorded()).toBeUndefined() // not processed → Stripe retries
  })

  it('a capturePaymentIntent write error returns 500 and does NOT record the event', async () => {
    current = makeDb(
      {
        registrations: [{ id: 'r1', status: 'pending', stripe_payment_intent_id: null }],
        participants: [],
        stripe_webhook_events: [],
      },
      { failUpdate: (t) => t === 'registrations' },
    )
    const res = await post({
      id: 'evt_cap_err', type: 'checkout.session.completed',
      data: { object: {
        id: 'cs_a', payment_status: 'paid', payment_intent: 'pi_1',
        metadata: { registrationId: 'r1' }, client_reference_id: 'r1',
        amount_total: 7500, currency: 'usd', customer: null, customer_details: null,
      } },
    } as unknown as Stripe.Event)

    expect(res.status).toBe(500)
    expect(recorded()).toBeUndefined()
  })

  it('a grantTier write failure on an invoice membership returns 500 and does NOT record the event', async () => {
    // reason 'error' = a real insert failure, distinct from the benign skips.
    h.grantTier.mockResolvedValueOnce({ granted: false, reason: 'error' })
    current = makeDb({ stripe_webhook_events: [] })
    const res = await post({
      id: 'evt_grant_err', type: 'invoice.paid',
      data: { object: { id: 'in_m', amount_paid: 9900, metadata: { type: 'membership_invoice', memberId: 'm1', tierId: 't1' } } },
    } as unknown as Stripe.Event)

    expect(res.status).toBe(500)
    expect(recorded()).toBeUndefined()
  })

  it('still short-circuits an already-processed event (idempotency preserved)', async () => {
    current = makeDb({
      registrations: [{ id: 'r1', status: 'pending' }],
      stripe_webhook_events: [{ id: 'evt_dup', type: 'invoice.paid' }],
    })
    const res = await post({
      id: 'evt_dup', type: 'invoice.paid',
      data: { object: { id: 'in_x', amount_paid: 40500, metadata: { registrationId: 'r1' } } },
    } as unknown as Stripe.Event)

    expect((await res.json()) as unknown).toMatchObject({ duplicate: true })
    expect(h.confirmRegistration).not.toHaveBeenCalled()
  })
})
