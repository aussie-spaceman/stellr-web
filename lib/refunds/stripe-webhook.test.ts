import { describe, it, expect, vi } from 'vitest'
import type Stripe from 'stripe'
import { fakeDb } from './fake-db.test-helper'

vi.mock('server-only', () => ({}))

import { recordExternalChargeRefunds } from './stripe-webhook'

// charge.refunded: a refund made in the Stripe dashboard is recorded against
// the registration it paid for, once, and the app's own refunds are left to
// the delete flow that made them.

const charge = { id: 'ch_1', amount: 7500, payment_intent: 'pi_1' } as unknown as Stripe.Charge

function stripeWith(refunds: Partial<Stripe.Refund>[]) {
  return { refunds: { list: vi.fn(async () => ({ data: refunds })) } } as unknown as Stripe
}

const seedTables = () => ({
  participants: [{ id: 'p1', registration_id: 'r1', member_id: 'm1', stripe_payment_intent_id: 'pi_1' }],
  registrations: [{ id: 'r1', event_slug: 'colorado', stripe_payment_intent_id: null }],
})

describe('recordExternalChargeRefunds', () => {
  it('records a dashboard refund against the participant who paid', async () => {
    const f = fakeDb(seedTables())
    const res = await recordExternalChargeRefunds(f.db as never, stripeWith([
      { id: 're_1', amount: 7500, currency: 'usd', status: 'succeeded', metadata: {}, reason: 'requested_by_customer' },
    ]), charge)

    expect(res.recorded).toBe(1)
    expect(f.upserts[0].opts).toMatchObject({ onConflict: 'stripe_refund_id', ignoreDuplicates: true })
    expect(f.upserts[0].rows[0]).toMatchObject({
      participant_id: 'p1', registration_id: 'r1', event_slug: 'colorado', refund_type: 'cash',
      source: 'stripe_external', stripe_refund_id: 're_1', refund_cents: 7500, currency: 'usd',
    })
  })

  it("skips the app's own refunds and failed ones", async () => {
    const f = fakeDb(seedTables())
    const res = await recordExternalChargeRefunds(f.db as never, stripeWith([
      { id: 're_app', amount: 1875, currency: 'usd', status: 'succeeded', metadata: { source: 'stellr_app' } },
      { id: 're_bad', amount: 100, currency: 'usd', status: 'failed', metadata: {} },
    ]), charge)

    expect(res.recorded).toBe(0)
    expect(f.upserts).toHaveLength(0)
  })

  it('a group payment is recorded against the registration, not one person', async () => {
    const f = fakeDb({
      participants: [
        { id: 'p1', registration_id: 'r1', member_id: 'm1', stripe_payment_intent_id: null },
        { id: 'p2', registration_id: 'r1', member_id: 'm2', stripe_payment_intent_id: null },
      ],
      registrations: [{ id: 'r1', event_slug: 'colorado', stripe_payment_intent_id: 'pi_1' }],
    })
    await recordExternalChargeRefunds(f.db as never, stripeWith([
      { id: 're_1', amount: 15000, currency: 'usd', status: 'succeeded', metadata: {} },
    ]), charge)

    expect(f.upserts[0].rows[0]).toMatchObject({ participant_id: null, registration_id: 'r1', member_id: null })
  })

  it('ignores charges that are not event registrations', async () => {
    const f = fakeDb({ participants: [], registrations: [] })
    const stripe = stripeWith([{ id: 're_1', amount: 100, currency: 'usd', status: 'succeeded', metadata: {} }])
    const res = await recordExternalChargeRefunds(f.db as never, stripe, charge)

    expect(res).toMatchObject({ recorded: 0, reason: 'not an event registration payment' })
    expect(stripe.refunds.list).not.toHaveBeenCalled()
  })
})
