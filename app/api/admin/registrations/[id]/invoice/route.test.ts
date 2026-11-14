// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { tenantWideScope } from '@/lib/tenancy/scope-context'

// "Invoice & discount…" on a group. Every action reads or changes Stellr's Stripe account and
// its coupons, so after loadEventRecord the group's event must be Stellr's, for a Stellr admin
// too (C20c). The staff check, Stripe and the billing helpers are stand-ins; the loaders in
// lib/tenancy/load-scoped.ts are real, over a fake database that records each query.

const ID = '22222222-2222-4222-8222-222222222222'
const OTHER_TENANT = '11111111-1111-4111-8111-111111111111'

const h = vi.hoisted(() => ({
  requireEventCrew: vi.fn(),
  registration: null as Record<string, unknown> | null,
  // The events mirror: slug → owning tenant. A slug it lacks reads as Stellr's.
  events: {} as Record<string, string | null>,
  eventsDown: false,
  tables: [] as string[],
  stripe: vi.fn(() => ({})),
  summary: vi.fn(),
  preview: vi.fn(),
  setDiscount: vi.fn(),
  reissue: vi.fn(),
  resolveCode: vi.fn(),
  logActivity: vi.fn(async (_entry: unknown, _db: unknown) => {}),
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
      if (table === 'registrations') return { data: h.registration, error: null }
      return { data: null, error: null }
    }
    return chain
  }
  return { from }
}

vi.mock('@/lib/authz', () => ({ requireEventCrew: h.requireEventCrew }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => fakeDb() }))
vi.mock('@/lib/stripe', () => ({ stripeClient: h.stripe }))
vi.mock('@/lib/activity-log', () => ({ actorFromAuth: async () => ({ actorType: 'admin', actorMemberId: 'm-admin' }), logActivity: h.logActivity }))
vi.mock('@/lib/group-billing', () => ({
  groupInvoiceSummary: h.summary,
  previewGroupDiscount: h.preview,
  setGroupDiscount: h.setDiscount,
  reissueGroupInvoice: h.reissue,
  resolveDiscountCode: h.resolveCode,
}))

const { GET, POST } = await import('./route')

const GROUP = { event_slug: 'msu', type: 'group', teacher_member_id: 'm-teacher' }
const url = `https://app.test/api/admin/registrations/${ID}/invoice`
const ctx = () => ({ params: Promise.resolve({ id: ID }) })
const get = () => GET(new Request(url), ctx())
const post = (body: unknown = { action: 'apply', code: 'SAVE10' }) =>
  POST(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), ctx())

/** requireEventCrew's answer for a Stellr admin, or an event manager on these events. */
function crew(opts: { tenantId?: string; assigned?: string[] | null } = {}) {
  const tenantId = opts.tenantId ?? STELLR_TENANT_ID
  const assigned = opts.assigned ?? null
  return {
    ok: true as const,
    userId: 'user_testadmin',
    isAdmin: assigned === null,
    tenantId,
    scope: tenantWideScope(tenantId, assigned === null ? 'tenant_admin' : 'crew'),
    covers: (slug: string | null | undefined) => assigned === null || (!!slug && assigned.includes(slug)),
  }
}

const SUMMARY = { places: 3, invoice: null, history: [] }

beforeEach(() => {
  vi.clearAllMocks()
  h.requireEventCrew.mockImplementation(async () => crew())
  h.registration = { ...GROUP }
  h.events = {}
  h.eventsDown = false
  h.tables = []
  h.summary.mockResolvedValue(SUMMARY)
  h.resolveCode.mockResolvedValue({ couponId: 'coupon_1', label: '10% off' })
  h.setDiscount.mockResolvedValue({ ok: true, message: 'Applied.', invoiceId: 'in_1' })
  vi.stubEnv('LOADSCOPED_MODE', '')
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('/api/admin/registrations/[id]/invoice', () => {
  it('on a Stellr event, reads the invoice and applies a discount as before', async () => {
    h.events = { msu: STELLR_TENANT_ID }
    const read = await get()
    expect(read.status).toBe(200)
    expect(await read.json()).toEqual(SUMMARY)
    const applied = await post()
    expect(applied.status).toBe(200)
    expect(await applied.json()).toEqual({ message: 'Applied.', invoiceId: 'in_1' })
    expect(h.setDiscount).toHaveBeenCalledWith(expect.anything(), expect.anything(), ID, { couponId: 'coupon_1', label: '10% off' }, { memberId: 'm-admin', label: 'admin' })
    expect(h.logActivity).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'm-teacher', action: 'group_invoice_discount_applied' }), expect.anything())
  })

  it('an event the mirror does not hold is Stellr\'s, after one owner read', async () => {
    expect((await get()).status).toBe(200)
    expect(h.tables).toEqual(['registrations', 'events'])
  })

  it('another tenant\'s event answers a Stellr admin as a missing group, and Stripe is never asked', async () => {
    h.events = { msu: OTHER_TENANT }
    const read = await get()
    const change = await post()
    expect(read.status).toBe(404)
    expect(change.status).toBe(404)
    expect(await read.json()).toEqual({ error: 'Group registration not found' })
    expect(h.summary).not.toHaveBeenCalled()
    expect(h.stripe).not.toHaveBeenCalled()
    expect(h.resolveCode).not.toHaveBeenCalled()
    expect(h.setDiscount).not.toHaveBeenCalled()
    expect(h.logActivity).not.toHaveBeenCalled()
    // The same answer a missing group gets, body and all.
    h.registration = null
    expect(await change.text()).toBe(await (await post()).text())
  })

  it('a failed read of the event\'s owner is a retryable 503, never Stellr\'s', async () => {
    h.eventsDown = true
    for (const res of [await get(), await post({ action: 'reissue' })]) {
      expect(res.status).toBe(503)
      expect(res.headers.get('Retry-After')).toBe('5')
    }
    expect(h.summary).not.toHaveBeenCalled()
    expect(h.stripe).not.toHaveBeenCalled()
    expect(h.reissue).not.toHaveBeenCalled()
  })

  it('the staff check comes first: a refused caller causes no read at all', async () => {
    h.events = { msu: OTHER_TENANT }
    for (const status of [401, 403] as const) {
      h.requireEventCrew.mockResolvedValueOnce({ ok: false, status })
      expect((await post()).status).toBe(status)
      h.requireEventCrew.mockResolvedValueOnce({ ok: false, status })
      expect((await get()).status).toBe(status)
    }
    expect(h.tables).toEqual([])
  })

  it('the registration is read before the owner, and an event manager off the event is refused before it', async () => {
    h.events = { msu: OTHER_TENANT }
    h.requireEventCrew.mockResolvedValue(crew({ assigned: ['other'] }))
    const res = await post()
    expect(res.status).toBe(404)
    expect(h.tables).toEqual(['registrations'])
  })

  it('a tenant\'s own staff keep the Stellr-only refusal, with no owner read', async () => {
    h.requireEventCrew.mockResolvedValue(crew({ tenantId: OTHER_TENANT }))
    h.registration = { ...GROUP, tenant_id: OTHER_TENANT }
    const res = await get()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: "This isn't available for your organisation yet." })
    expect(h.tables).not.toContain('events')
  })

  it('a group that is not a group answers as missing, with no owner read', async () => {
    h.registration = { ...GROUP, type: 'individual' }
    expect((await get()).status).toBe(404)
    expect(h.tables).toEqual(['registrations'])
  })
})
