import { describe, it, expect, vi, beforeEach } from 'vitest'
import type Stripe from 'stripe'

// deep review PAY-16: a guest store order is created with email '' (no member),
// so it was unreachable for support/returns and the buyer got no confirmation
// email. handleStoreOrderPaid must backfill the email from the Stripe session,
// persist it on the order, and send the confirmation to it — while never
// overwriting a member's own address.

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_args: unknown) => {}),
  logActivity: vi.fn(async () => {}),
  printfulEnabled: vi.fn(() => false), // skip fulfilDirect's DB work in these tests
  createOrder: vi.fn(async () => ({ id: 'pf_1' })),
}))

type Row = Record<string, unknown>
let tables: Record<string, Row[]>
function from(table: string) {
  const filters: ((r: Row) => boolean)[] = []
  let pendingUpdate: Row | null = null
  const matched = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
  const run = () => {
    if (pendingUpdate) for (const r of matched()) Object.assign(r, pendingUpdate)
    return { data: matched(), error: null }
  }
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
    is: (c: string, v: unknown) => (filters.push((r) => (v === null ? r[c] == null : r[c] === v)), q),
    update: (set: Row) => ((pendingUpdate = set), q),
    maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve),
  }
  return q
}

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from }) }))
vi.mock('@/lib/activity-log', () => ({ logActivity: h.logActivity }))
vi.mock('@/lib/email', () => ({ sendEmail: h.sendEmail }))
vi.mock('./printful', () => ({ printfulEnabled: h.printfulEnabled, createOrder: h.createOrder }))

import { handleStoreOrderPaid } from './orders'

const session = (over: Record<string, unknown> = {}) => ({
  id: 'cs_1',
  metadata: { orderId: 'o1' },
  payment_intent: 'pi_1',
  amount_total: 2595,
  currency: 'usd',
  customer: null,
  total_details: { amount_shipping: 595, amount_tax: 0 },
  customer_details: { email: 'guest@home.com', name: 'Guest', address: null },
  ...over,
}) as unknown as Stripe.Checkout.Session

beforeEach(() => {
  vi.clearAllMocks()
})

describe('handleStoreOrderPaid guest email backfill (PAY-16)', () => {
  it('backfills a guest order’s empty email from the session and emails the buyer', async () => {
    tables = { store_orders: [{ id: 'o1', member_id: null, email: '', status: 'pending', subtotal_cents: 2000 }] }
    await handleStoreOrderPaid(session())
    // The order row now carries the buyer's email (reachable for support/returns).
    expect(tables.store_orders[0].email).toBe('guest@home.com')
    // The confirmation email went to that address (the old code skipped it on '').
    expect(h.sendEmail).toHaveBeenCalledTimes(1)
    expect((h.sendEmail.mock.calls[0][0] as unknown as { to: string }).to).toBe('guest@home.com')
  })

  it('never overwrites a member order’s own email with the session address', async () => {
    tables = { store_orders: [{ id: 'o1', member_id: 'm1', email: 'member@x.com', status: 'pending', subtotal_cents: 2000 }] }
    await handleStoreOrderPaid(session({ customer_details: { email: 'different@stripe.com' } }))
    expect(tables.store_orders[0].email).toBe('member@x.com')
    expect((h.sendEmail.mock.calls[0][0] as unknown as { to: string }).to).toBe('member@x.com')
  })

  it('sends nothing when neither the order nor the session has an email', async () => {
    tables = { store_orders: [{ id: 'o1', member_id: null, email: '', status: 'pending', subtotal_cents: 2000 }] }
    await handleStoreOrderPaid(session({ customer_details: { email: null } }))
    expect(h.sendEmail).not.toHaveBeenCalled()
  })
})
