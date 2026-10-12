import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review PAY-13/PAY-15: the store-returns refund path had no test. Pin that
// an admin-approved return consults the test-key guard before issuing the Stripe
// refund (a test-mode refund settles nothing).

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  canManage: true,
  refundsCreate: vi.fn(async () => ({ id: 're_1' })),
  assertLiveCredentials: vi.fn(),
}))

type Row = Record<string, unknown>
let tables: Record<string, Row[]>
function from(table: string) {
  const filters: ((r: Row) => boolean)[] = []
  let pendingUpdate: Row | null = null
  const matched = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
  const run = () => {
    if (pendingUpdate) {
      for (const r of matched()) Object.assign(r, pendingUpdate)
    }
    return { data: matched(), error: null }
  }
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
    update: (set: Row) => ((pendingUpdate = set), q),
    maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve),
  }
  return q
}

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from }) }))
vi.mock('@/lib/store/auth', () => ({
  currentStoreMember: async () => ({ id: 'm1', email: 'm1@x.com' }),
  canManageStoreCatalog: async () => h.canManage,
}))
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: h.assertLiveCredentials }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => ({ refunds: { create: h.refundsCreate } }) }))

import { PATCH } from './route'

function patch(body: Record<string, unknown>) {
  return PATCH(new Request('http://localhost/api/store/returns', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.canManage = true
  tables = {
    store_returns: [{ id: 'ret1', order_id: 'o1', status: 'requested' }],
    store_orders: [{ id: 'o1', stripe_payment_intent_id: 'pi_1' }],
  }
})

describe('PATCH /api/store/returns approve (PAY-15)', () => {
  it('consults the test-key guard before issuing the refund', async () => {
    const res = await patch({ returnId: 'ret1', action: 'approve' })
    const json = (await res.json()) as { ok: boolean; refundId: string }
    expect(json).toMatchObject({ ok: true, refundId: 're_1' })
    expect(h.assertLiveCredentials).toHaveBeenCalledWith('stripe')
    expect(h.refundsCreate).toHaveBeenCalledWith({ payment_intent: 'pi_1' })
    expect(tables.store_orders[0].status).toBe('refunded')
  })
})
