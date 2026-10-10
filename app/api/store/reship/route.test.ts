import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review PAY-2: /api/store/reship must enforce, server-side, that a reship
// only ever ships the caller's own, actually-paid items from a paid event-merch
// order, for an event that has ended, once per source order — and never a whole
// group's shirts or an unpaid add-on.

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  member: { id: 'm1', email: 'm1@example.com' } as { id: string; email: string } | null,
  createPendingOrder: vi.fn(async (_input: unknown) => ({ orderId: 'reship1', subtotalCents: 0 })),
  sessionsCreate: vi.fn(async () => ({ url: 'https://checkout.stripe.com/x' })),
  eventEndedPast: true, // event end date in the past unless a test flips it
}))

// In-memory DB: supports select/eq/neq/maybeSingle and a head/count select.
type Row = Record<string, unknown>
let tables: Record<string, Row[]>
function builder(table: string) {
  const filters: ((r: Row) => boolean)[] = []
  let head = false
  const matched = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
  const q: Record<string, unknown> = {
    select: (_cols?: string, opts?: { head?: boolean; count?: string }) => {
      if (opts?.head) head = true
      return q
    },
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
    neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), q),
    maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve(head ? { count: matched().length, error: null } : { data: matched(), error: null }).then(resolve),
  }
  return q
}

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from: builder }) }))
vi.mock('@/lib/store/auth', () => ({ currentStoreMember: async () => h.member }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => ({ checkout: { sessions: { create: h.sessionsCreate } } }) }))
vi.mock('@/lib/store/orders', () => ({ createPendingOrder: h.createPendingOrder, STORE_FLAT_SHIPPING_CENTS: 595 }))
vi.mock('@/lib/sanity', () => ({
  getEventBySlug: async () => ({ date: h.eventEndedPast ? '2020-01-01' : '2999-01-01' }),
}))

import { POST } from './route'

const req = (orderId?: string) =>
  new Request('http://localhost/api/store/reship', {
    method: 'POST',
    body: JSON.stringify(orderId ? { orderId } : {}),
  }) as never

// A group event-merch order: the organiser (m1) is the order owner and also a
// participant; p2 is another student whose shirt is on the same order; there is
// one unpaid (pending) add-on belonging to m1.
function seedGroupOrder() {
  tables = {
    store_orders: [
      { id: 'o1', member_id: 'm1', channel: 'event_registration', status: 'paid', event_slug: 'colorado', registration_id: 'r1' },
    ],
    store_order_items: [
      { order_id: 'o1', variant_id: 'v_m1', sku: 'S-M1', name: 'Shirt M1', qty: 1, participant_member_id: 'm1', fulfillment_status: 'awaiting_batch' },
      { order_id: 'o1', variant_id: 'v_p2', sku: 'S-P2', name: 'Shirt P2', qty: 1, participant_member_id: 'm2', fulfillment_status: 'awaiting_batch' },
      { order_id: 'o1', variant_id: 'v_addon', sku: 'A-M1', name: 'Addon M1', qty: 1, participant_member_id: 'm1', fulfillment_status: 'pending' },
    ],
    participants: [{ id: 'p_m1', registration_id: 'r1', member_id: 'm1', merch_collected: false }],
  }
  // The route reads items via a nested select on store_orders; surface them.
  ;(tables.store_orders[0] as Row).items = tables.store_order_items
}

beforeEach(() => {
  vi.clearAllMocks()
  h.member = { id: 'm1', email: 'm1@example.com' }
  h.eventEndedPast = true
  seedGroupOrder()
})

describe('POST /api/store/reship (PAY-2)', () => {
  it('copies only the caller’s own paid items — not other participants’, not unpaid add-ons', async () => {
    const res = await POST(req('o1'))
    expect(res.status).toBe(200)
    expect(h.createPendingOrder).toHaveBeenCalledTimes(1)
    const arg = h.createPendingOrder.mock.calls[0][0] as { sourceOrderId: string; lines: { variantId: string }[] }
    expect(arg.sourceOrderId).toBe('o1')
    expect(arg.lines.map((l) => l.variantId)).toEqual(['v_m1'])
  })

  it('refuses a second reship of the same source order (409)', async () => {
    // A live reship already exists for o1.
    tables.store_orders.push({ id: 'reship_prev', member_id: 'm1', channel: 'reship', status: 'pending', source_order_id: 'o1' })
    const res = await POST(req('o1'))
    expect(res.status).toBe(409)
    expect(h.createPendingOrder).not.toHaveBeenCalled()
  })

  it('refuses when the caller already collected their merch (400)', async () => {
    ;(tables.participants[0] as Row).merch_collected = true
    const res = await POST(req('o1'))
    expect(res.status).toBe(400)
    expect(h.createPendingOrder).not.toHaveBeenCalled()
  })

  it('refuses before the event has ended (400)', async () => {
    h.eventEndedPast = false
    const res = await POST(req('o1'))
    expect(res.status).toBe(400)
    expect(h.createPendingOrder).not.toHaveBeenCalled()
  })

  it('refuses an order that is not the caller’s paid event-merch order (404)', async () => {
    ;(tables.store_orders[0] as Row).status = 'pending'
    const res = await POST(req('o1'))
    expect(res.status).toBe(404)
    expect(h.createPendingOrder).not.toHaveBeenCalled()
  })
})
