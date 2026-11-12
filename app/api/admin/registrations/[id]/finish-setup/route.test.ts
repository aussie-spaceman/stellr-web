// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { tenantWideScope } from '@/lib/tenancy/scope-context'

// "Finish registration setup" on a group. The preview looks for the group's invoice on
// Stellr's Stripe account, and the run creates that invoice and sends Stellr's mail to the
// teacher, so after loadEventRecord the group's event must be Stellr's, for a Stellr admin
// too (C20c). The staff check and the setup steps are stand-ins; the loaders in
// lib/tenancy/load-scoped.ts are real, over a fake database that records each table read.

const ID = '22222222-2222-4222-8222-222222222222'
const OTHER_TENANT = '11111111-1111-4111-8111-111111111111'

const h = vi.hoisted(() => ({
  requireEventStaff: vi.fn(),
  registration: null as Record<string, unknown> | null,
  // The events mirror: slug → owning tenant. A slug it lacks reads as Stellr's.
  events: {} as Record<string, string | null>,
  eventsDown: false,
  tables: [] as string[],
  // Stand-ins for the steps, which reach Stripe (findGroupInvoice, createAndSendGroupInvoice)
  // and the teacher's inbox (the confirmation and follow-up mail).
  preview: vi.fn(),
  finish: vi.fn(),
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

vi.mock('@/lib/authz', () => ({ requireEventStaff: h.requireEventStaff }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => fakeDb() }))
vi.mock('@/lib/activity-log', () => ({ actorFromAuth: async () => ({ actorType: 'admin', actorMemberId: 'm-admin' }), logActivity: h.logActivity }))
vi.mock('@/lib/group-registration-setup', () => ({
  SETUP_STEPS: ['sheet', 'join_link', 'invoice', 'confirmation', 'follow_up'],
  previewGroupSetup: h.preview,
  finishGroupSetup: h.finish,
}))

const { GET, POST } = await import('./route')

const GROUP = { event_slug: 'msu', type: 'group', teacher_member_id: 'm-teacher' }
const url = `https://app.test/api/admin/registrations/${ID}/finish-setup`
const ctx = () => ({ params: Promise.resolve({ id: ID }) })
const get = () => GET(new Request(url), ctx())
const post = (body: unknown = { steps: ['invoice', 'confirmation'] }) =>
  POST(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), ctx())

/** requireEventStaff's answer for a Stellr admin, or an event manager on these events. */
function staff(opts: { tenantId?: string; assigned?: string[] | null } = {}) {
  const tenantId = opts.tenantId ?? STELLR_TENANT_ID
  const assigned = opts.assigned ?? null
  return {
    ok: true as const,
    userId: 'user_testadmin',
    isAdmin: assigned === null,
    tenantId,
    scope: tenantWideScope(tenantId, assigned === null ? 'tenant_admin' : 'staff'),
    covers: (slug: string | null | undefined) => assigned === null || (!!slug && assigned.includes(slug)),
  }
}

const ITEMS = [{ step: 'invoice', needed: true, summary: 'No invoice yet' }]
const RESULTS = { invoice: 'sent', confirmation: 'sent' }

beforeEach(() => {
  vi.clearAllMocks()
  h.requireEventStaff.mockImplementation(async () => staff())
  h.registration = { ...GROUP }
  h.events = {}
  h.eventsDown = false
  h.tables = []
  h.preview.mockResolvedValue(ITEMS)
  h.finish.mockResolvedValue(RESULTS)
  vi.stubEnv('LOADSCOPED_MODE', '')
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('/api/admin/registrations/[id]/finish-setup', () => {
  it('on a Stellr event, previews and runs the steps as before', async () => {
    h.events = { msu: STELLR_TENANT_ID }
    const read = await get()
    expect(read.status).toBe(200)
    expect(await read.json()).toEqual({ items: ITEMS })
    const run = await post()
    expect(run.status).toBe(200)
    expect(await run.json()).toEqual({ results: RESULTS })
    expect(h.finish).toHaveBeenCalledWith(expect.anything(), ID, ['invoice', 'confirmation'])
    expect(h.logActivity).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'm-teacher', action: 'group_setup_finished' }), expect.anything())
  })

  it('an event the mirror does not hold is Stellr\'s, after one owner read', async () => {
    expect((await get()).status).toBe(200)
    expect(h.tables).toEqual(['registrations', 'events'])
  })

  it('another tenant\'s event answers a Stellr admin as a missing group, and no step runs', async () => {
    h.events = { msu: OTHER_TENANT }
    const read = await get()
    const run = await post()
    expect(read.status).toBe(404)
    expect(run.status).toBe(404)
    expect(await read.json()).toEqual({ error: 'Group registration not found' })
    // Neither the Stripe invoice lookup nor the invoice, the mail or the activity row.
    expect(h.preview).not.toHaveBeenCalled()
    expect(h.finish).not.toHaveBeenCalled()
    expect(h.logActivity).not.toHaveBeenCalled()
    // The same answer a missing group gets, body and all.
    h.registration = null
    expect(await run.text()).toBe(await (await post()).text())
  })

  it('a failed read of the event\'s owner is a retryable 503, never Stellr\'s', async () => {
    h.eventsDown = true
    for (const res of [await get(), await post()]) {
      expect(res.status).toBe(503)
      expect(res.headers.get('Retry-After')).toBe('5')
    }
    expect(h.preview).not.toHaveBeenCalled()
    expect(h.finish).not.toHaveBeenCalled()
  })

  it('the staff check comes first: a refused caller causes no read at all', async () => {
    h.events = { msu: OTHER_TENANT }
    for (const status of [401, 403] as const) {
      h.requireEventStaff.mockResolvedValueOnce({ ok: false, status })
      expect((await post()).status).toBe(status)
      h.requireEventStaff.mockResolvedValueOnce({ ok: false, status })
      expect((await get()).status).toBe(status)
    }
    expect(h.tables).toEqual([])
  })

  it('the registration is read before the owner, and an event manager off the event is refused before it', async () => {
    h.events = { msu: OTHER_TENANT }
    h.requireEventStaff.mockResolvedValue(staff({ assigned: ['other'] }))
    const res = await post()
    expect(res.status).toBe(404)
    expect(h.tables).toEqual(['registrations'])
  })

  it('a tenant\'s own staff keep the Stellr-only refusal, with no owner read', async () => {
    h.requireEventStaff.mockResolvedValue(staff({ tenantId: OTHER_TENANT }))
    h.registration = { ...GROUP, tenant_id: OTHER_TENANT }
    const res = await get()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: "This isn't available for your organisation yet." })
    expect(h.tables).not.toContain('events')
  })

  it('a registration that is not a group answers as missing, with no owner read', async () => {
    h.registration = { ...GROUP, type: 'individual' }
    expect((await get()).status).toBe(404)
    expect(h.tables).toEqual(['registrations'])
  })
})
