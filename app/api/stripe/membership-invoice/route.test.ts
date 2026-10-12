import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review PAY-13/PAY-14/PAY-15: the membership-invoice money path had no test.
// Pin the three behaviours this PR changes:
//   PAY-14 — the invoice is billed at the LIVE Stripe price (not the DB fallback),
//            and a repeat click reuses an already-open invoice instead of emailing
//            a second one.
//   PAY-15 — the charge path consults the test-key guard (assertLiveCredentials).

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  userId: 'u1' as string | null,
  invoicesCreate: vi.fn(async () => ({ id: 'in_1' })),
  invoiceItemsCreate: vi.fn(async () => ({ id: 'ii_1' })),
  invoicesFinalize: vi.fn(async (id: string) => ({ id, hosted_invoice_url: 'https://pay/in_1' })),
  invoicesSend: vi.fn(async () => ({})),
  invoicesSearch: vi.fn(async () => ({ data: [] as Array<{ hosted_invoice_url: string | null }> })),
  pricesRetrieve: vi.fn(async () => ({ unit_amount: 12000, currency: 'usd' })),
  customersUpdate: vi.fn(async () => ({})),
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
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: h.assertLiveCredentials }))
vi.mock('@/lib/stripe', () => ({
  requireStripe: () => ({
    customers: { update: h.customersUpdate },
    invoices: {
      create: h.invoicesCreate,
      finalizeInvoice: h.invoicesFinalize,
      sendInvoice: h.invoicesSend,
      search: h.invoicesSearch,
    },
    invoiceItems: { create: h.invoiceItemsCreate },
    prices: { retrieve: h.pricesRetrieve },
  }),
}))

import { POST } from './route'

function post(body: Record<string, unknown>) {
  return POST(new Request('http://localhost/api/stripe/membership-invoice', {
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
      { id: 't1', name: 'Catalyst', annual_cost_cents: 9900, is_free: false, stripe_price_id: 'price_live' },
    ],
    members: [{ id: 'm1', clerk_user_id: 'u1', email: 'ed@school.org', first_name: 'Ed', last_name: 'U', stripe_customer_id: 'cus_1' }],
    member_schools: [], // no current school → no tax address → no customers.update
  }
})

describe('POST /api/stripe/membership-invoice (PAY-14 / PAY-15)', () => {
  it('bills the LIVE Stripe price, not the DB annual_cost_cents fallback (PAY-14)', async () => {
    const res = await post({ tierName: 'Catalyst' })
    expect(res.status).toBe(200)
    // prices.retrieve returned 12000; the DB fallback was 9900 — the item uses 12000.
    expect(h.pricesRetrieve).toHaveBeenCalledWith('price_live')
    expect(h.invoiceItemsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ invoice: 'in_1', amount: 12000, currency: 'usd' }),
    )
    // PAY-15: the charge path consulted the test-key guard.
    expect(h.assertLiveCredentials).toHaveBeenCalledWith('stripe')
  })

  it('falls back to the DB cost when no Stripe price is configured (PAY-14)', async () => {
    tables.membership_tiers[0].stripe_price_id = null
    await post({ tierName: 'Catalyst' })
    expect(h.pricesRetrieve).not.toHaveBeenCalled()
    expect(h.invoiceItemsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 9900, currency: 'usd' }),
    )
  })

  it('reuses an already-open invoice instead of emailing a second one (PAY-14 dedup)', async () => {
    h.invoicesSearch.mockResolvedValueOnce({ data: [{ hosted_invoice_url: 'https://pay/existing' }] })
    const res = await post({ tierName: 'Catalyst' })
    const json = (await res.json()) as { hostedInvoiceUrl: string; deduped?: boolean }
    expect(json).toMatchObject({ hostedInvoiceUrl: 'https://pay/existing', deduped: true })
    // No new invoice was created or sent.
    expect(h.invoicesCreate).not.toHaveBeenCalled()
    expect(h.invoicesSend).not.toHaveBeenCalled()
  })

  it('creates a fresh invoice when the dedup search errors (fail-open, never blocks the first)', async () => {
    h.invoicesSearch.mockRejectedValueOnce(new Error('search unavailable'))
    const res = await post({ tierName: 'Catalyst' })
    expect(res.status).toBe(200)
    expect(h.invoicesCreate).toHaveBeenCalledTimes(1)
    expect(h.invoicesSend).toHaveBeenCalledTimes(1)
  })
})
