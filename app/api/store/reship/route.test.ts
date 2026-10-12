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
  assertLiveCredentials: vi.fn(), // deep review PAY-15: no-op guard spy.
  eventEndedPast: true, // event end date in the past unless a test flips it
}))

// In-memory DB: supports select/eq/neq/lt/maybeSingle, a head/count select, and
// update(...) that mutates matched rows in place (deep review PAY-N3 needs the
// stale-pending cancel to actually flip the row's status).
type Row = Record<string, unknown>
let tables: Record<string, Row[]>
function builder(table: string) {
  const filters: ((r: Row) => boolean)[] = []
  let head = false
  let pendingUpdate: Row | null = null
  const matched = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
  const run = () => {
    if (pendingUpdate) {
      const rows = matched()
      for (const r of rows) Object.assign(r, pendingUpdate)
      return { data: rows, error: null }
    }
    return head ? { count: matched().length, error: null } : { data: matched(), error: null }
  }
  const q: Record<string, unknown> = {
    select: (_cols?: string, opts?: { head?: boolean; count?: string }) => {
      if (opts?.head) head = true
      return q
    },
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
    neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), q),
    lt: (c: string, v: unknown) => (filters.push((r) => String(r[c]) < String(v)), q),
    update: (set: Row) => ((pendingUpdate = set), q),
    maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve),
  }
  return q
}

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from: builder }) }))
vi.mock('@/lib/store/auth', () => ({ currentStoreMember: async () => h.member }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => ({ checkout: { sessions: { create: h.sessionsCreate } } }) }))
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: h.assertLiveCredentials }))
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
    // deep review PAY-15: the charge path consulted the test-key guard.
    expect(h.assertLiveCredentials).toHaveBeenCalledWith('stripe')
  })

  it('refuses a second reship of the same source order (409)', async () => {
    // A live, still-fresh reship already exists for o1.
    tables.store_orders.push({ id: 'reship_prev', member_id: 'm1', channel: 'reship', status: 'pending', source_order_id: 'o1', created_at: new Date().toISOString() })
    const res = await POST(req('o1'))
    expect(res.status).toBe(409)
    expect(h.createPendingOrder).not.toHaveBeenCalled()
  })

  it('PAY-N3: cancels an abandoned (stale pending) reship and lets a new one proceed', async () => {
    // An earlier reship checkout was never paid; its pending order is >24h old.
    // Without the cleanup it would block every future reship of o1 forever (409).
    const stale = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    tables.store_orders.push({ id: 'reship_stale', member_id: 'm1', channel: 'reship', status: 'pending', source_order_id: 'o1', created_at: stale })
    const res = await POST(req('o1'))
    expect(res.status).toBe(200)
    expect(h.createPendingOrder).toHaveBeenCalledTimes(1)
    // The abandoned order was cancelled (so it no longer blocks, and the unique
    // partial index — which excludes cancelled rows — won't reject the new insert).
    const staleRow = tables.store_orders.find((r) => r.id === 'reship_stale')
    expect(staleRow?.status).toBe('cancelled')
  })

  it('PAY-N3: still 409s on a fresh in-flight pending reship (under 24h)', async () => {
    const fresh = new Date(Date.now() - 60 * 1000).toISOString()
    tables.store_orders.push({ id: 'reship_live', member_id: 'm1', channel: 'reship', status: 'pending', source_order_id: 'o1', created_at: fresh })
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
