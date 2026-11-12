// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A teacher adds a discount code to their own group's invoice (9 Nov 2026: two
// teachers were sent invoices without the code they registered with, and only staff
// could fix it). The teacher and the Teacher POC can change it, any code included;
// a student manager can see it; view-as can't write. Only promotion codes resolve.

const h = vi.hoisted(() => ({
  userId: 'user_1' as string | null,
  member: { id: 'm-1', email: 'teacher@example.com' } as { id: string; email: string } | null,
  registration: null as Record<string, unknown> | null,
  impersonating: false,
  resolve: vi.fn(),
  setDiscount: vi.fn(),
  preview: vi.fn(),
  summary: vi.fn(),
  logActivity: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: h.userId }) }))
vi.mock('@/lib/rate-limit-async', () => ({ rateLimit: async () => null }))
// Stellr's host, as requestTenant answers with routing off. S5 A8: the route now
// compares the group's tenant with this, so the placeholder id it used is Stellr's.
vi.mock('@/lib/tenancy/request-tenant', async () => {
  const { STELLR_TENANT_ID } = await import('@/lib/tenancy/constants')
  return { requestTenant: async () => ({ kind: 'stellr', tenantId: STELLR_TENANT_ID }) }
})
vi.mock('@/lib/stripe', () => ({ stripeClient: () => ({}) }))
vi.mock('@/lib/activity-log', () => ({ actorFromAuth: async () => ({ actorType: 'member' }), logActivity: h.logActivity }))
vi.mock('@/lib/audit/route', () => ({ withAudit: (_spec: unknown, handler: unknown) => handler }))
vi.mock('@/lib/impersonation', () => ({
  assertNotImpersonating: async () => (h.impersonating ? new Response('{}', { status: 403 }) : null),
  resolveRequestMember: async () => ({ member: h.member, unauthorised: !h.userId, impersonating: h.impersonating }),
}))
vi.mock('@/lib/group-billing', () => ({
  eventSeatPrice: async () => ({ unitCents: 9700, currency: 'usd', productId: 'prod_event' }),
  groupInvoiceSummary: h.summary,
  previewGroupDiscount: h.preview,
  resolveDiscountCode: h.resolve,
  setGroupDiscount: h.setDiscount,
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: table === 'members' ? h.member : h.registration, error: null }),
      }
      return chain
    },
  }),
}))

import { GET, POST } from './route'

const ctx = { params: Promise.resolve({ id: 'reg-1' }) }
const REG = {
  id: 'reg-1', type: 'group', event_slug: 'msu', teacher_member_id: 'm-1', teacher_email: 'teacher@example.com',
  teacher_poc_email: null, registrant_role: 'teacher', invoice_requested: true, invoice_paid_at: null,
}
const DISCOUNT = { couponId: 'co_15', code: 'STEMCAREERS', label: 'STEMCAREERS (15% off)', terms: { percentOff: 15, amountOffCents: null } }
const post = (body: unknown = { action: 'apply', code: 'STEMCAREERS' }) =>
  POST(new Request('http://localhost/api/members/teams/reg-1/discount', { method: 'POST', body: JSON.stringify(body) }) as never, ctx)
const get = () => GET(new Request('http://localhost/x') as never, ctx)

beforeEach(() => {
  vi.clearAllMocks()
  h.userId = 'user_1'
  h.member = { id: 'm-1', email: 'teacher@example.com' }
  h.registration = { ...REG }
  h.impersonating = false
  h.resolve.mockResolvedValue(DISCOUNT)
  h.setDiscount.mockResolvedValue({ ok: true, message: 'Sent a revised invoice.', invoiceId: 'in_2' })
  h.preview.mockResolvedValue({ ok: true, label: DISCOUNT.label, summary: '12 × $97.00 = $1,164.00, less $174.60 = $989.40' })
  h.summary.mockResolvedValue({ discount: null, currency: 'usd', current: { id: 'in_1', status: 'open', totalCents: 116400, hostedUrl: null } })
})

describe('POST /api/members/teams/[id]/discount', () => {
  it('lets the teacher apply a code, as a promotion code for this event only', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(h.resolve).toHaveBeenCalledWith(expect.anything(), 'STEMCAREERS', { promotionCodesOnly: true, productId: 'prod_event' })
    expect(h.setDiscount).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'reg-1', DISCOUNT, { memberId: 'm-1', label: 'teacher' })
    expect(h.logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'group_invoice_discount_applied', memberId: 'm-1' }), expect.anything())
  })

  it('previews without changing anything', async () => {
    const res = await post({ action: 'preview', code: 'STEMCAREERS' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ summary: expect.stringContaining('$989.40') })
    expect(h.setDiscount).not.toHaveBeenCalled()
  })

  it('removes a code, staff’s included', async () => {
    expect((await post({ action: 'remove' })).status).toBe(200)
    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.setDiscount).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'reg-1', null, expect.anything())
  })

  it('lets the Teacher POC apply one', async () => {
    h.member = { id: 'm-2', email: 'poc@example.com' }
    h.registration = { ...REG, teacher_member_id: 'm-9', teacher_email: 'sm@example.com', registrant_role: 'student_manager', teacher_poc_email: 'poc@example.com' }
    expect((await post()).status).toBe(200)
  })

  it('refuses a code that does not resolve, without touching the invoice', async () => {
    h.resolve.mockResolvedValue(null)
    const res = await post({ action: 'apply', code: 'SCHOLARSHIP100' })
    expect(res.status).toBe(404)
    expect(h.setDiscount).not.toHaveBeenCalled()
  })

  it('refuses a student manager', async () => {
    h.registration = { ...REG, registrant_role: 'student_manager' }
    expect((await post()).status).toBe(403)
    expect(h.setDiscount).not.toHaveBeenCalled()
  })

  it('refuses someone who does not manage the group, as if it did not exist', async () => {
    h.member = { id: 'm-3', email: 'student@example.com' }
    expect((await post()).status).toBe(404)
  })

  it('refuses view-as and a signed-out caller', async () => {
    h.impersonating = true
    expect((await post()).status).toBe(403)
    h.impersonating = false
    h.userId = null
    expect((await post()).status).toBe(401)
    expect(h.setDiscount).not.toHaveBeenCalled()
  })

  it('refuses a paid invoice, or a group not paying by invoice, before asking Stripe', async () => {
    h.registration = { ...REG, invoice_paid_at: '2026-11-09T00:00:00Z' }
    expect((await post()).status).toBe(409)
    h.registration = { ...REG, invoice_requested: false }
    expect((await post()).status).toBe(409)
    expect(h.resolve).not.toHaveBeenCalled()
  })

  it('needs a code to apply or preview', async () => {
    expect((await post({ action: 'apply' })).status).toBe(400)
    expect((await post({ action: 'apply', code: '  ' })).status).toBe(400)
  })

  it('passes on a refusal from the invoice change', async () => {
    h.setDiscount.mockResolvedValue({ ok: false, error: 'The invoice is void, so it can’t be revised.' })
    const res = await post()
    expect(res.status).toBe(409)
    expect(h.logActivity).not.toHaveBeenCalled()
  })
})

describe('GET /api/members/teams/[id]/discount', () => {
  it('shows the teacher the code and lets them change it', async () => {
    h.summary.mockResolvedValue({ discount: { code: 'STEMCAREERS', couponId: 'co_15' }, currency: 'usd', current: { status: 'open', totalCents: 98940, hostedUrl: null } })
    const body = await (await get()).json()
    expect(body).toMatchObject({ applies: true, code: 'STEMCAREERS', canChange: true, lockedReason: null, invoice: { totalCents: 98940 } })
  })

  it('names a staff discount with no code without showing the coupon id', async () => {
    h.summary.mockResolvedValue({ discount: { code: null, couponId: 'SCHOLARSHIP100' }, currency: 'usd', current: { status: 'open', totalCents: 0, hostedUrl: null } })
    const body = await (await get()).json()
    expect(body.code).toBe('Discount applied by Stellr')
    expect(JSON.stringify(body)).not.toContain('SCHOLARSHIP100')
  })

  it('is read-only for a student manager, and locked once paid', async () => {
    h.registration = { ...REG, registrant_role: 'student_manager' }
    expect(await (await get()).json()).toMatchObject({ canChange: false, readOnlyNote: expect.stringMatching(/teacher/) })
    h.registration = { ...REG, invoice_paid_at: '2026-11-09T00:00:00Z' }
    expect(await (await get()).json()).toMatchObject({ lockedReason: expect.stringMatching(/paid/) })
  })

  it('says nothing applies to a group that does not pay by invoice', async () => {
    h.registration = { ...REG, invoice_requested: false }
    expect(await (await get()).json()).toEqual({ applies: false })
    expect(h.summary).not.toHaveBeenCalled()
  })
})
