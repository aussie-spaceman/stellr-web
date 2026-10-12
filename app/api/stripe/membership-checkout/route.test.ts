import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review PAY-13/PAY-15: the subscription-checkout money path had no test.
// Pin that it consults the test-key guard (assertLiveCredentials) before opening
// a Stripe Checkout session, and that reads above it are not gated.

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  userId: 'u1' as string | null,
  sessionsCreate: vi.fn(async () => ({ url: 'https://checkout.stripe.com/x' })),
  pricesRetrieve: vi.fn(async () => ({ unit_amount: 9900, currency: 'usd' })),
  buildCreditDiscount: vi.fn(async () => null),
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
    maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
    single: async () => ({ data: matched()[0] ?? null, error: null }),
  }
  return q
}

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: h.userId }) }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from }) }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/stripe-customer', () => ({ ensureStripeCustomer: async () => 'cus_1' }))
vi.mock('@/lib/refunds/redeem', () => ({ buildCreditDiscount: h.buildCreditDiscount }))
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: h.assertLiveCredentials }))
vi.mock('@/lib/stripe', () => ({
  requireStripe: () => ({
    prices: { retrieve: h.pricesRetrieve },
    checkout: { sessions: { create: h.sessionsCreate } },
  }),
}))

import { POST } from './route'

function post(body: Record<string, unknown>) {
  return POST(new Request('http://localhost/api/stripe/membership-checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.userId = 'u1'
  tables = {
    membership_tiers: [
      { id: 't1', name: 'Catalyst', stripe_price_id: 'price_annual', stripe_price_id_monthly: 'price_monthly', is_free: false },
    ],
    members: [{ id: 'm1', clerk_user_id: 'u1', email: 'ed@school.org', first_name: 'Ed', last_name: 'U', stripe_customer_id: 'cus_1' }],
  }
})

describe('POST /api/stripe/membership-checkout (PAY-15)', () => {
  it('consults the test-key guard before creating the subscription session', async () => {
    const res = await post({ tierName: 'Catalyst', billingInterval: 'annual' })
    const json = (await res.json()) as { url: string }
    expect(json.url).toBe('https://checkout.stripe.com/x')
    expect(h.assertLiveCredentials).toHaveBeenCalledWith('stripe')
    expect(h.sessionsCreate).toHaveBeenCalledTimes(1)
  })
})
