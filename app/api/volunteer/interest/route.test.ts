// @vitest-environment node
//
// S5 wave 7, A10b (decision W7-12, default): volunteer interest is for Stellr's events
// only. Another tenant's event, and any event asked about from another tenant's host,
// answers as an event that does not exist, and nothing is written. Stellr's events are
// saved as before, with the row's tenant supplied.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { STELLR_TENANT_ID as STELLR } from '@/lib/tenancy/constants'
import { TENANT_ID_HEADER, TENANT_ROUTING_FLAG, TENANT_SLUG_HEADER } from '@/lib/tenancy/host'
import { fakeChainDb, type ChainCall } from '@/test/helpers/fake-chain-db'

const CANARY = 'c0000000-0000-4000-8000-0000000000aa'

const h = vi.hoisted(() => ({
  headers: new Headers(),
  owner: null as string | null,
  ownerFails: false,
  calls: [] as unknown[],
  logActivity: vi.fn(async () => {}),
}))

vi.mock('next/headers', () => ({ headers: async () => h.headers }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/community', () => ({ getCurrentMember: async () => ({ id: 'm-volunteer' }) }))
vi.mock('@/lib/volunteer', () => ({ isVolunteer: async () => true }))
vi.mock('@/lib/events/repo', () => ({ getEventBySlug: async (slug: string) => (slug === 'missing' ? null : { title: 'The Event' }) }))
vi.mock('@/lib/activity-log', () => ({ logActivity: h.logActivity }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => {
    const { db, calls } = fakeChainDb((call: ChainCall) => {
      if (call.table === 'events') return h.ownerFails ? { data: null, error: { message: 'down' } } : { data: { tenant_id: h.owner }, error: null }
      return { data: null, error: null }
    })
    h.calls = calls
    return db
  },
}))
// The audit wrapper is tested on its own; here it only passes the call through.
vi.mock('@/lib/audit/route', () => ({ withAudit: (_spec: unknown, fn: unknown) => fn }))

const { POST } = await import('./route')

const offer = (eventSlug = 'the-event', interested = true) =>
  POST(new NextRequest('https://app.example.test/api/volunteer/interest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventSlug, interested }) }))
const upserts = () => (h.calls as ChainCall[]).filter((c) => c.table === 'volunteer_event_interest')

function onCanaryHost() {
  vi.stubEnv(TENANT_ROUTING_FLAG, 'true')
  h.headers = new Headers({ [TENANT_ID_HEADER]: CANARY, [TENANT_SLUG_HEADER]: 'canary' })
}

beforeEach(() => {
  h.headers = new Headers()
  h.owner = null
  h.ownerFails = false
  h.calls = []
  h.logActivity.mockClear()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('volunteer interest', () => {
  it("refuses another tenant's event as one that does not exist, and writes nothing", async () => {
    h.owner = CANARY
    const res = await offer()
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Event not found.' })
    expect(upserts()).toEqual([])
    expect(h.logActivity).not.toHaveBeenCalled()
  })

  it("saves interest in Stellr's event, an unmirrored one included, with the row's tenant", async () => {
    for (const owner of [STELLR, null]) {
      h.owner = owner
      const res = await offer()
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, interested: true })
      expect(upserts()).toHaveLength(1)
      expect(upserts()[0].payload).toMatchObject({ tenant_id: STELLR, member_id: 'm-volunteer', event_slug: 'the-event', status: 'interested' })
    }
  })

  it("refuses Stellr's event on another tenant's host, and that tenant's own event too", async () => {
    onCanaryHost()
    for (const owner of [STELLR, null, CANARY]) {
      h.owner = owner
      expect((await offer()).status).toBe(404)
    }
    expect(upserts()).toEqual([])
  })

  it('answers a failed owner read with a retryable 503, never as Stellr’s', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.ownerFails = true
    const res = await offer()
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('5')
    expect(upserts()).toEqual([])
  })

  it('still answers a slug with no event as before, without reading its owner', async () => {
    const res = await offer('missing')
    expect(res.status).toBe(404)
    expect((h.calls as ChainCall[]).filter((c) => c.table === 'events')).toEqual([])
  })
})
