// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { eventRouteFor, eventRouteRefused } from '@/test/fixtures/event-route'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// Marking a group invoice paid or unpaid. The invoice is on Stellr's Stripe account until S9,
// so a tenant's event is refused for everyone, a Stellr admin included (C20c). The staff check
// is a stand-in; the loaders in lib/tenancy/load-scoped.ts are real, over a fake database that
// records each query.

const ID = '22222222-2222-4222-8222-222222222222'
const OTHER_TENANT = '11111111-1111-4111-8111-111111111111'

interface Query {
  table: string
  op: string
  values?: Record<string, unknown>
}

const h = vi.hoisted(() => ({
  requireEventRoute: vi.fn(),
  registration: null as Record<string, unknown> | null,
  // The events mirror: slug → owning tenant. A slug it lacks reads as Stellr's.
  events: {} as Record<string, string | null>,
  eventsDown: false,
  queries: [] as unknown[],
  logActivity: vi.fn(async (_entry: unknown, _db: unknown) => {}),
}))

function fakeDb() {
  const from = (table: string) => {
    const q: Query = { table, op: 'select' }
    h.queries.push(q)
    let slug: unknown
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.update = (values: Record<string, unknown>) => {
      q.op = 'update'
      q.values = values
      return chain
    }
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
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null })
    return chain
  }
  return { from }
}

vi.mock('@/lib/authz', () => ({ requireEventRoute: h.requireEventRoute }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => fakeDb() }))
vi.mock('@/lib/activity-log', () => ({ actorFromAuth: async () => ({ actorType: 'admin', actorMemberId: 'm-admin' }), logActivity: h.logActivity }))

const { POST } = await import('./route')

const REG = { id: ID, event_slug: 'colorado', invoice_requested: true, teacher_member_id: 'm-teacher' }

function post(body: unknown = { registrationId: ID, paid: true }, slug = 'colorado') {
  return POST(
    new Request(`https://app.test/api/admin/events/${slug}/invoice-paid`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) },
  )
}

const queries = (table: string) => (h.queries as Query[]).filter((q) => q.table === table)
const writes = () => (h.queries as Query[]).filter((q) => q.op !== 'select')

beforeEach(() => {
  vi.clearAllMocks()
  h.requireEventRoute.mockImplementation(async (slug: string) => eventRouteFor(slug))
  h.registration = { ...REG }
  h.events = {}
  h.eventsDown = false
  h.queries = []
  vi.stubEnv('LOADSCOPED_MODE', '')
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/admin/events/[slug]/invoice-paid', () => {
  it('on a Stellr event, marks the invoice paid and logs it, as before', async () => {
    h.events = { colorado: STELLR_TENANT_ID }
    const res = await post()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, invoicePaidAt: expect.any(String) })
    expect(writes()).toHaveLength(1)
    expect(writes()[0]).toMatchObject({ table: 'registrations', op: 'update', values: { invoice_paid_by: 'm-admin' } })
    expect(h.logActivity).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'm-teacher', action: 'invoice_marked_paid' }), expect.anything())
  })

  it('an event the mirror does not hold is Stellr\'s, and clearing works as before', async () => {
    const res = await post({ registrationId: ID, paid: false })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, invoicePaidAt: null })
    expect(writes()[0]).toMatchObject({ values: { invoice_paid_at: null, invoice_paid_by: null } })
    expect(queries('events')).toHaveLength(1)
  })

  it('404s another tenant\'s event for a Stellr admin, before the registration is read or written', async () => {
    h.events = { colorado: OTHER_TENANT }
    const res = await post()
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
    expect(queries('registrations')).toEqual([])
    expect(writes()).toEqual([])
    expect(h.logActivity).not.toHaveBeenCalled()
  })

  it('a failed read of the event\'s owner is a retryable 503, never Stellr\'s', async () => {
    h.eventsDown = true
    const res = await post()
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('5')
    expect(queries('registrations')).toEqual([])
    expect(writes()).toEqual([])
  })

  it('the staff check comes first: a refused caller causes no read at all', async () => {
    h.events = { colorado: OTHER_TENANT }
    for (const status of [401, 403, 404] as const) {
      h.requireEventRoute.mockResolvedValueOnce(eventRouteRefused(status))
      expect((await post()).status).toBe(status)
    }
    expect(h.queries).toEqual([])
  })

  it('a tenant\'s own staff get the Stellr-only refusal before the owner read', async () => {
    h.requireEventRoute.mockResolvedValueOnce(eventRouteFor('colorado', OTHER_TENANT))
    const res = await post()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: "This isn't available for your organisation yet." })
    expect(h.queries).toEqual([])
  })

  it('still 404s a registration on a different event, and 400s one not paid by invoice', async () => {
    expect((await post(undefined, 'texas')).status).toBe(404)
    h.registration = { ...REG, invoice_requested: false }
    expect((await post()).status).toBe(400)
    expect(writes()).toEqual([])
  })
})
