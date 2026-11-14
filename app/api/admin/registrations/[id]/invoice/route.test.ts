// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { tenantWideScope } from '@/lib/tenancy/scope-context'
import { LOADSCOPED_MODES } from '@/lib/tenancy/load-scoped-mode'

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
  // What lib/activity-log's crewActorType reads from the session: 'staff' for Staff, else 'admin'.
  crewActorType: vi.fn(async (): Promise<'admin' | 'staff'> => 'admin'),
  authzThrows: false,
  audits: [] as unknown[],
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

vi.mock('@/lib/authz', () => ({
  requireEventCrew: async (...args: unknown[]) => {
    if (h.authzThrows) throw new Error('clerk unavailable')
    return h.requireEventCrew(...args)
  },
}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => fakeDb() }))
vi.mock('@/lib/stripe', () => ({ stripeClient: h.stripe }))
vi.mock('@/lib/activity-log', () => ({
  actorFromAuth: async () => ({ actorType: 'admin', actorMemberId: 'm-admin' }),
  crewActorType: h.crewActorType,
  logActivity: h.logActivity,
}))
vi.mock('@/lib/audit/platform', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  audit: async (input: unknown) => {
    h.audits.push(input)
    return { ok: true, id: 1, seq: 1 }
  },
}))
let pending: Promise<unknown>[] = []
vi.mock('@/lib/after-response', () => ({
  runAfterResponse: (_label: string, task: () => Promise<unknown>) => {
    pending.push(task())
  },
}))
const flush = async () => {
  await Promise.all(pending.splice(0))
}
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
  h.authzThrows = false
  h.audits = []
  pending = []
  h.crewActorType.mockResolvedValue('admin')
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

// staff-role.10: whoever changes the invoice is named as they are. Staff passes the crew check
// as a non-admin with every event (lib/authz/decide.ts decideEventAccess), so before this it
// was written down as an event manager.
describe('who the billing helpers are told changed the invoice', () => {
  const staffCrew = () => ({ ...crew(), isAdmin: false, scope: tenantWideScope(STELLR_TENANT_ID, 'crew') })

  it('an admin is admin, and may use an internal coupon id', async () => {
    expect((await post()).status).toBe(200)
    expect(h.setDiscount).toHaveBeenCalledWith(expect.anything(), expect.anything(), ID, expect.anything(), { memberId: 'm-admin', label: 'admin' })
    expect(h.resolveCode).toHaveBeenCalledWith(expect.anything(), 'SAVE10', { promotionCodesOnly: false })
  })

  it('Staff is staff, and enters promotion codes only, as before', async () => {
    h.requireEventCrew.mockResolvedValue(staffCrew())
    h.crewActorType.mockResolvedValue('staff')
    expect((await post()).status).toBe(200)
    expect(h.setDiscount).toHaveBeenCalledWith(expect.anything(), expect.anything(), ID, expect.anything(), { memberId: 'm-admin', label: 'staff' })
    expect(h.resolveCode).toHaveBeenCalledWith(expect.anything(), 'SAVE10', { promotionCodesOnly: true })
  })

  it('an event manager on the event is event_manager, and enters promotion codes only', async () => {
    h.requireEventCrew.mockResolvedValue(crew({ assigned: ['msu'] }))
    // crewActorType answers 'admin' for anyone who is not Staff; the crew check decides the rest.
    h.crewActorType.mockResolvedValue('admin')
    expect((await post()).status).toBe(200)
    expect(h.setDiscount).toHaveBeenCalledWith(expect.anything(), expect.anything(), ID, expect.anything(), { memberId: 'm-admin', label: 'event_manager' })
    expect(h.resolveCode).toHaveBeenCalledWith(expect.anything(), 'SAVE10', { promotionCodesOnly: true })
  })

  it('a reissue carries the same label', async () => {
    h.requireEventCrew.mockResolvedValue(staffCrew())
    h.crewActorType.mockResolvedValue('staff')
    h.reissue.mockResolvedValue({ ok: true, message: 'Corrected.', invoiceId: 'in_2' })
    expect((await post({ action: 'reissue' })).status).toBe(200)
    expect(h.reissue).toHaveBeenCalledWith(expect.anything(), expect.anything(), ID, { memberId: 'm-admin', label: 'staff' })
  })
})

// C16-INVOICE (docs/TENANCY-S5.md, "invoice alongside payment-method"): the stamped-tenant
// check on the loaded row. The fake database here answers the row whatever the filter, so
// each mode shows the route's own check, not the enforced read's.
describe('a group stamped with another tenant', () => {
  for (const mode of LOADSCOPED_MODES) {
    it(`answers exactly as a missing group, under LOADSCOPED_MODE=${mode}, with no read past the row and no Stripe`, async () => {
      vi.stubEnv('LOADSCOPED_MODE', mode)
      h.registration = { ...GROUP, tenant_id: OTHER_TENANT }
      const read = await get()
      const change = await post()
      expect(read.status).toBe(404)
      expect(change.status).toBe(404)
      // The stamp is read in the existing select: no owner read, and no query a missing
      // group would not cost in the same mode (shadow reads the row both ways).
      const foreignTables = h.tables.splice(0)
      expect(foreignTables).not.toContain('events')
      expect(h.summary).not.toHaveBeenCalled()
      expect(h.stripe).not.toHaveBeenCalled()
      expect(h.resolveCode).not.toHaveBeenCalled()
      expect(h.setDiscount).not.toHaveBeenCalled()
      expect(h.logActivity).not.toHaveBeenCalled()
      h.registration = null
      expect(await read.text()).toBe(await (await get()).text())
      expect(await change.text()).toBe(await (await post()).text())
      expect(foreignTables).toEqual(h.tables)
    })

    it(`its own tenant's group goes on as before, under LOADSCOPED_MODE=${mode}`, async () => {
      vi.stubEnv('LOADSCOPED_MODE', mode)
      h.registration = { ...GROUP, tenant_id: STELLR_TENANT_ID }
      expect((await get()).status).toBe(200)
      expect((await post()).status).toBe(200)
      expect(h.setDiscount).toHaveBeenCalledTimes(1)
    })
  }

  it('an event manager on the event gets the same missing answer', async () => {
    h.requireEventCrew.mockResolvedValue(crew({ assigned: ['msu'] }))
    h.registration = { ...GROUP, tenant_id: OTHER_TENANT }
    const foreign = await post()
    expect(foreign.status).toBe(404)
    h.registration = null
    expect(await foreign.text()).toBe(await (await post()).text())
  })

  it('a row with no stamp is Stellr\'s, as the enforced read takes it to be', async () => {
    h.registration = { ...GROUP, tenant_id: null }
    expect((await post()).status).toBe(200)
  })

  it('the selected columns include the stamp', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('./route.ts', import.meta.url), 'utf8')
    expect(src).toContain("select: 'event_slug, type, teacher_member_id, tenant_id'")
  })
})

describe('audit, with PLATFORM_AUDIT_ENABLED=true', () => {
  beforeEach(() => {
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
    h.events = { msu: STELLR_TENANT_ID }
  })

  it('a change records the caller, Stellr\'s chain and the group', async () => {
    expect((await post()).status).toBe(200)
    await flush()
    expect(h.audits).toHaveLength(1)
    expect(h.audits[0]).toMatchObject({
      action: 'registration.invoice.change',
      actor: 'user_testadmin',
      tenantId: STELLR_TENANT_ID,
      target: { table: 'registrations', id: ID },
      metadata: { invoiceAction: 'apply', couponId: 'coupon_1', invoiceId: 'in_1' },
    })
  })

  it('a failure before the staff check still names the row, and marks its chain unresolved', async () => {
    h.authzThrows = true
    await expect(post()).rejects.toThrow()
    await expect(get()).rejects.toThrow()
    await flush()
    expect(h.audits).toHaveLength(2)
    for (const [i, action] of ['registration.invoice.change', 'registration.invoice.read'].entries()) {
      expect(h.audits[i]).toMatchObject({
        action,
        tenantId: null,
        target: { table: 'registrations', id: ID },
        metadata: { tenant_unresolved: true },
      })
    }
  })

  it('a group stamped with another tenant records nothing, as any refusal', async () => {
    h.registration = { ...GROUP, tenant_id: OTHER_TENANT }
    expect((await post()).status).toBe(404)
    await flush()
    expect(h.audits).toEqual([])
  })
})
