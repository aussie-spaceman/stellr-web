import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review PAY-13/PAY-16/PAY-15: the storefront checkout money path had no
// test. Pin:
//   PAY-16 — the member's tier discount is resolved via getActiveTierIdsByMember
//            (which filters out expired rows and tolerates two active rows, where
//            the old .maybeSingle() errored and dropped the discount), and the
//            BEST discount across the member's active tiers is applied per item.
//   PAY-15 — the charge path consults the test-key guard before creating a session.

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  userId: 'u1' as string | null,
  sessionsCreate: vi.fn(async () => ({ url: 'https://checkout.stripe.com/x' })),
  createPendingOrder: vi.fn(async (_input: unknown) => ({ orderId: 'o1', subtotalCents: 0 })),
  computeUnitPrice: vi.fn(),
  getActiveTierIdsByMember: vi.fn(async () => new Map<string, string[]>()),
  assertLiveCredentials: vi.fn(),
}))

type Row = Record<string, unknown>
let tables: Record<string, Row[]>
function from(table: string) {
  const filters: ((r: Row) => boolean)[] = []
  const matched = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
    in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
    maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: matched(), error: null }).then(resolve),
  }
  return q
}

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: h.userId }) }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from }) }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/stripe-customer', () => ({ ensureStripeCustomer: async () => 'cus_1' }))
vi.mock('@/lib/store/pricing', () => ({ computeUnitPrice: h.computeUnitPrice }))
vi.mock('@/lib/store/orders', () => ({ createPendingOrder: h.createPendingOrder, STORE_FLAT_SHIPPING_CENTS: 595 }))
vi.mock('@/lib/tiers-server', () => ({ getActiveTierIdsByMember: h.getActiveTierIdsByMember }))
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: h.assertLiveCredentials }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => ({ checkout: { sessions: { create: h.sessionsCreate } } }) }))

import { POST } from './route'

function post(items: Array<{ variantId: string; qty: number }>) {
  return POST(new Request('http://localhost/api/store/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.userId = 'u1'
  tables = {
    members: [{ id: 'm1', clerk_user_id: 'u1', email: 'buyer@x.com', stripe_customer_id: 'cus_1' }],
    store_variants: [
      {
        id: 'v1', sku: 'SKU1', label: 'M', market_price_cents: 2000, active: true,
        product: { id: 'p1', name: 'Tee', status: 'active', product_type: 'apparel' },
      },
    ],
  }
})

describe('POST /api/store/checkout (PAY-16 / PAY-15)', () => {
  it('resolves tiers via getActiveTierIdsByMember and applies the BEST discount across them', async () => {
    // The member holds two active tiers; tier B gives the better (lower) price.
    h.getActiveTierIdsByMember.mockResolvedValueOnce(new Map([['m1', ['tierA', 'tierB']]]))
    h.computeUnitPrice.mockImplementation(async (_v: unknown, _p: unknown, ctx: { tierId?: string | null }) => {
      if (ctx.tierId === 'tierA') return { base_cents: 2000, percent_off: 10, unit_cents: 1800 }
      if (ctx.tierId === 'tierB') return { base_cents: 2000, percent_off: 25, unit_cents: 1500 }
      return { base_cents: 2000, percent_off: 0, unit_cents: 2000 }
    })

    const res = await post([{ variantId: 'v1', qty: 1 }])
    expect(res.status).toBe(200)
    // PAY-16: the unfiltered member_memberships query is gone — the route delegates.
    expect(h.getActiveTierIdsByMember).toHaveBeenCalledWith(['m1'])
    // The order line carries the BEST unit price (tier B, 1500), not tier A's 1800.
    const arg = h.createPendingOrder.mock.calls[0][0] as unknown as { lines: Array<{ unitCents: number }> }
    expect(arg.lines[0].unitCents).toBe(1500)
    // PAY-15: the charge path consulted the test-key guard.
    expect(h.assertLiveCredentials).toHaveBeenCalledWith('stripe')
  })

  it('applies no discount when the member has no active (unexpired) tier', async () => {
    h.getActiveTierIdsByMember.mockResolvedValueOnce(new Map()) // none active
    h.computeUnitPrice.mockResolvedValue({ base_cents: 2000, percent_off: 0, unit_cents: 2000 })
    await post([{ variantId: 'v1', qty: 1 }])
    // computeUnitPrice was called with no tier id → full price.
    expect(h.computeUnitPrice).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.objectContaining({ kind: 'storefront', tierId: null }),
    )
    const arg = h.createPendingOrder.mock.calls[0][0] as unknown as { lines: Array<{ unitCents: number }> }
    expect(arg.lines[0].unitCents).toBe(2000)
  })
})
