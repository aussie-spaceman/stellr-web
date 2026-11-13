// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// The refund preview in the admin delete dialog. It reads Stellr's Stripe account, so after the
// participant load the place's event must be Stellr's, for a Stellr admin too (C20c). The staff
// check, Stripe and the payment resolution are stand-ins; lib/refunds/preview.ts and the loaders
// in lib/tenancy/load-scoped.ts are real, over a fake database that records each query.

const PID = '22222222-2222-4222-8222-222222222222'
const RID = '33333333-3333-4333-8333-333333333333'
const OTHER_TENANT = '11111111-1111-4111-8111-111111111111'

const h = vi.hoisted(() => ({
  requireTenantCrew: vi.fn(),
  tenantId: '',
  participant: null as Record<string, unknown> | null,
  registration: null as Record<string, unknown> | null,
  // The events mirror: slug → owning tenant. A slug it lacks reads as Stellr's.
  events: {} as Record<string, string | null>,
  eventsDown: false,
  tables: [] as string[],
  resolveRefundBasis: vi.fn(),
  stripeRefundState: vi.fn(),
  stripe: vi.fn(() => ({})),
}))

function fakeDb() {
  const from = (table: string) => {
    h.tables.push(table)
    let slug: unknown
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = (col: string, value: unknown) => {
      if (col === 'slug') slug = value
      return chain
    }
    for (const m of ['or', 'in', 'is', 'not', 'limit']) chain[m] = () => chain
    chain.maybeSingle = async () => {
      if (table === 'events') {
        if (h.eventsDown) return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
        const s = String(slug)
        return { data: s in h.events ? { slug: s, tenant_id: h.events[s] } : null, error: null }
      }
      if (table === 'participants') return { data: h.participant, error: null }
      if (table === 'registrations') return { data: h.registration, error: null }
      return { data: null, error: null }
    }
    // event_refunds: no earlier refund.
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
    return chain
  }
  return { from }
}

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'user_testadmin' }) }))
vi.mock('@/lib/authz', () => ({ requireTenantCrew: h.requireTenantCrew, currentTenantId: () => h.tenantId }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => fakeDb() }))
vi.mock('@/lib/stripe', () => ({ stripeClient: h.stripe }))
vi.mock('@/lib/refunds/payment-basis', () => ({ resolveRefundBasis: h.resolveRefundBasis }))
vi.mock('@/lib/refunds/stripe-state', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  stripeRefundState: h.stripeRefundState,
}))

const { GET } = await import('./route')
const { EMPTY_REFUND_PREVIEW } = await import('@/lib/refunds/preview')

const get = (participant: string | null = PID) =>
  GET(new Request(`https://app.test/api/admin/refunds/preview${participant ? `?participant=${participant}` : ''}`))

const PAID_DAYS_AGO = 10

beforeEach(() => {
  vi.clearAllMocks()
  h.tenantId = STELLR_TENANT_ID
  h.requireTenantCrew.mockImplementation(async (tenantId: string) => ({ ok: true, via: 'clerk', tenantId }))
  h.participant = { id: PID, registration_id: RID, individual_payment_status: 'paid', stripe_payment_intent_id: 'pi_1' }
  h.registration = { event_slug: 'colorado' }
  h.events = {}
  h.eventsDown = false
  h.tables = []
  h.resolveRefundBasis.mockResolvedValue({ paymentIntent: 'pi_1', paid: true, perPlaceCents: 10000, currency: 'usd', stripeInvoiceId: null, payer: 'self' })
  h.stripeRefundState.mockResolvedValue({ amountCents: 10000, refundedCents: 0, currency: 'usd', paidAt: new Date(Date.now() - PAID_DAYS_AGO * 86_400_000) })
  vi.stubEnv('LOADSCOPED_MODE', '')
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /api/admin/refunds/preview', () => {
  it('on a Stellr event, previews the refund as before', async () => {
    h.events = { colorado: STELLR_TENANT_ID }
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ paid: true, paidCents: 10000, currency: 'usd', daysSincePayment: PAID_DAYS_AGO, guaranteeDays: 45, options: { cash: { pct: 100, cents: 10000 } }, hasPaymentRef: true, alreadyRefunded: false, externalRefund: null })
    expect(h.resolveRefundBasis).toHaveBeenCalledTimes(1)
    expect(h.stripeRefundState).toHaveBeenCalledWith('pi_1')
  })

  it('an event the mirror does not hold is Stellr\'s: the participant, its registration and the owner are each read once, in that order', async () => {
    expect((await get()).status).toBe(200)
    expect(h.tables.slice(0, 3)).toEqual(['participants', 'registrations', 'events'])
    expect(h.tables.filter((t) => t === 'participants')).toHaveLength(1)
    expect(h.resolveRefundBasis).toHaveBeenCalledTimes(1)
  })

  it('404s a participant on another tenant\'s event for a Stellr admin, and Stripe is never asked', async () => {
    h.events = { colorado: OTHER_TENANT }
    const res = await get()
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
    expect(h.resolveRefundBasis).not.toHaveBeenCalled()
    expect(h.stripeRefundState).not.toHaveBeenCalled()
    expect(h.stripe).not.toHaveBeenCalled()
    expect(h.tables).not.toContain('event_refunds')
  })

  it('a failed read of the event\'s owner is a retryable 503, never Stellr\'s', async () => {
    h.eventsDown = true
    const res = await get()
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('5')
    expect(h.resolveRefundBasis).not.toHaveBeenCalled()
    expect(h.stripeRefundState).not.toHaveBeenCalled()
  })

  it('the staff check comes first: a refused caller causes no read at all', async () => {
    h.events = { colorado: OTHER_TENANT }
    h.requireTenantCrew.mockResolvedValue({ ok: false, status: 403 })
    const res = await get()
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
    expect(h.tables).toEqual([])
  })

  it('a participant nobody can reach is still the empty preview, with no owner read', async () => {
    h.participant = null
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(EMPTY_REFUND_PREVIEW)
    expect(h.tables).toEqual(['participants'])
  })

  it('a participant whose registration cannot be found is the empty preview, with no owner read', async () => {
    h.registration = null
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(EMPTY_REFUND_PREVIEW)
    expect(h.tables).toEqual(['participants', 'registrations'])
    expect(h.resolveRefundBasis).not.toHaveBeenCalled()
  })

  it('a tenant\'s own admin gets the empty preview as before, with no extra reads', async () => {
    h.tenantId = OTHER_TENANT
    h.participant = { ...h.participant, stellr_scope_parent: { tenant_id: OTHER_TENANT } }
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(EMPTY_REFUND_PREVIEW)
    expect(h.tables).toEqual(['participants'])
    expect(h.resolveRefundBasis).not.toHaveBeenCalled()
  })

  it('asks for a participant', async () => {
    expect((await get(null)).status).toBe(400)
    expect(h.tables).toEqual([])
  })
})
