// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The paid one-off path runs the minor participation-agreement gate BEFORE a
// Stripe Checkout exists (3 Nov 2026), so a minor without an agreement is never
// charged. Enforced + locked → the same refusal as the free and credit paths;
// report-only → Checkout proceeds (the gate logs the would-block itself).

const h = vi.hoisted(() => ({
  enforced: false,
  unlocked: true,
  gate: vi.fn(),
  reserved: false,
  enrollFree: vi.fn(async () => ({ ok: true }) as { ok: boolean; reason?: string }),
  enrollWithCredit: vi.fn(async () => ({ ok: true }) as { ok: boolean; reason?: string }),
  checkoutCreate: vi.fn(async () => ({ url: 'https://checkout.example/cs_1' })),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/community', () => ({
  getCurrentMember: async () => ({ id: 'm1', activeTierIds: [] }),
  communityWriteBlock: async () => null,
}))
vi.mock('@/lib/mentoring', () => ({
  getCohortFull: async () => ({ id: 'c1', name: 'Rocketry', isOpen: true, oneOffPriceCents: 12000, oneOffStripePriceId: null }),
  resolveCohortAccess: async () => ({ enrolled: false, kind: 'paid' }),
  enrollFree: (...args: unknown[]) => h.enrollFree(...(args as [])),
  enrollWithCredit: (...args: unknown[]) => h.enrollWithCredit(...(args as [])),
}))
vi.mock('@/lib/access-gates', () => ({
  accessGatesEnforced: () => h.enforced,
  reportEnrollmentGate: async (...args: unknown[]) => {
    h.gate(...args)
    return { minorAgreement: h.unlocked, unlocked: h.unlocked }
  },
}))
vi.mock('@/lib/stripe', () => ({
  stripeClient: () => ({ checkout: { sessions: { create: h.checkoutCreate } } }),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => {
    const q = {
      from: () => q,
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: { email: 'buyer@example.test', stripe_customer_id: 'cus_1' }, error: null }),
    }
    return q
  },
}))
vi.mock('@/lib/stripe-customer', () => ({ ensureStripeCustomer: async () => 'cus_1' }))
vi.mock('@/lib/entitlements', () => ({
  getOrCreateCohortOffering: async () => 'off1',
  hasReservedCohortBooking: async () => h.reserved,
}))
vi.mock('@/lib/academy-discount', () => ({
  getAcademyDiscountPercent: async () => 0,
  academyLineItemFromPrice: vi.fn(),
  discountCents: (c: number) => c,
}))
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: () => {} }))
vi.mock('@/lib/guarantee', () => ({ GUARANTEE_CHECKOUT_TEXT: {} }))

import { POST } from './route'

const register = (method: 'free' | 'credit' | 'paid') =>
  POST(new Request('http://localhost/api/community/mentoring/register', {
    method: 'POST',
    body: JSON.stringify({ cohortId: 'c1', method }),
  }))
const paid = () => register('paid')

// A held paid seat (3 Nov 2026): the backstop kept the member off the roster but
// the ledger booking stands. No second charge or credit draw for the same cohort.
const PENDING = { error: 'Your place in this cohort is already booked and waiting on our team. You do not need to pay again; we will be in touch.' }

describe('POST /api/community/mentoring/register — a seat already booked but not rostered', () => {
  it('refuses a second Checkout when a reserved booking exists', async () => {
    h.reserved = true
    const res = await paid()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual(PENDING)
    expect(h.checkoutCreate).not.toHaveBeenCalled()
  })

  it('gives the same answer when the credit or free path finds the booking', async () => {
    for (const method of ['credit', 'free'] as const) {
      const fn = method === 'credit' ? h.enrollWithCredit : h.enrollFree
      fn.mockResolvedValueOnce({ ok: false, reason: 'booking-pending' })
      const res = await register(method)
      expect(res.status, method).toBe(409)
      expect(await res.json(), method).toEqual(PENDING)
    }
  })
})

beforeEach(() => {
  vi.clearAllMocks()
  h.enforced = false
  h.unlocked = true
  h.reserved = false
})

describe('POST /api/community/mentoring/register — paid seat, minor-agreement gate', () => {
  it('refuses before creating a Checkout when enforced and locked', async () => {
    h.enforced = true
    h.unlocked = false
    const res = await paid()
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Could not join this cohort' })
    expect(h.checkoutCreate).not.toHaveBeenCalled()
    expect(h.gate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm1' }),
      { kind: 'cohort', containerId: 'c1', containerName: 'Rocketry' },
    )
  })

  it('creates the Checkout in report-only mode, after running the gate', async () => {
    h.enforced = false
    h.unlocked = false
    const res = await paid()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://checkout.example/cs_1' })
    expect(h.gate).toHaveBeenCalledTimes(1)
    expect(h.checkoutCreate).toHaveBeenCalledTimes(1)
  })

  it('creates the Checkout when enforced and the gate is unlocked', async () => {
    h.enforced = true
    const res = await paid()
    expect(res.status).toBe(200)
    expect(h.checkoutCreate).toHaveBeenCalledTimes(1)
  })
})
