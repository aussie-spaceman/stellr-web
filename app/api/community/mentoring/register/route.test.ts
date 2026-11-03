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
  checkoutCreate: vi.fn(async () => ({ url: 'https://checkout.example/cs_1' })),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/community', () => ({
  getCurrentMember: async () => ({ id: 'm1', activeTierIds: [] }),
}))
vi.mock('@/lib/mentoring', () => ({
  getCohortFull: async () => ({ id: 'c1', name: 'Rocketry', isOpen: true, oneOffPriceCents: 12000, oneOffStripePriceId: null }),
  resolveCohortAccess: async () => ({ enrolled: false, kind: 'paid' }),
  enrollFree: vi.fn(),
  enrollWithCredit: vi.fn(),
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
vi.mock('@/lib/entitlements', () => ({ getOrCreateCohortOffering: async () => 'off1' }))
vi.mock('@/lib/academy-discount', () => ({
  getAcademyDiscountPercent: async () => 0,
  academyLineItemFromPrice: vi.fn(),
  discountCents: (c: number) => c,
}))
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: () => {} }))
vi.mock('@/lib/guarantee', () => ({ GUARANTEE_CHECKOUT_TEXT: {} }))

import { POST } from './route'

const paid = () =>
  POST(new Request('http://localhost/api/community/mentoring/register', {
    method: 'POST',
    body: JSON.stringify({ cohortId: 'c1', method: 'paid' }),
  }))

beforeEach(() => {
  vi.clearAllMocks()
  h.enforced = false
  h.unlocked = true
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
