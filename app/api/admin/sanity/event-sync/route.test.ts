// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// deep review AUTH-10: the Sanity → Supabase event-sync webhook must accept its
// shared secret ONLY via the x-webhook-secret header, never the ?secret= query
// string (which leaks into access logs). The constant-time compare and _id
// requirement are unchanged; this pins that the query form no longer authorises.

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({}) }))
vi.mock('@/lib/event-space-sync', () => ({
  syncEventSpace: async () => ({ containerId: 'c1', spaceId: 's1', created: true, renamedFrom: null, notes: [] }),
}))
vi.mock('@/lib/object-created-rules', () => ({ fireObjectCreatedRules: async () => ({}) }))
vi.mock('@/lib/survey/distributions', () => ({ ensureDistribution: async () => ({ action: 'scheduled' }) }))
vi.mock('@/lib/survey/events', () => ({ loadSurveyEvent: async () => null }))
// Real constant-time compare — the behaviour under test is which transport is read.
vi.mock('@/lib/secret-compare', () => ({ safeStrEqual: (a: string, b: string) => a === b }))
const hubspot = vi.hoisted(() => ({
  isProd: false,
  sync: vi.fn(async () => ({
    ok: true,
    applied: true,
    liveEvents: [],
    unmapped: [],
    properties: [{ object: 'contacts', property: 'event', status: 'updated' }],
    form: { status: 'unchanged' },
  })),
}))
vi.mock('@/lib/env-guards', () => ({ isRealProductionApp: () => hubspot.isProd }))
vi.mock('@/lib/hubspot-event-options', () => ({ syncEventOptions: hubspot.sync }))
// S3 events mirror: the route calls syncEventMirrorSafe last; it must never be
// able to fail the webhook.
const mirror = vi.hoisted(() => ({ sync: vi.fn(async (_db: unknown, _by: unknown) => ({ status: 'synced' as string })) }))
vi.mock('@/lib/events/sync', () => ({ syncEventMirrorSafe: mirror.sync }))

const SECRET = 'top-secret-value'
const { POST } = await import('./route')

function body() {
  return JSON.stringify({ _id: 'doc1', _type: 'event', slug: { current: 'co-sdc' }, title: 'CO SDC' })
}

beforeEach(() => { process.env.SANITY_WEBHOOK_SECRET = SECRET })
afterEach(() => { delete process.env.SANITY_WEBHOOK_SECRET })

describe('POST /api/admin/sanity/event-sync — secret transport (AUTH-10)', () => {
  it('rejects the secret supplied only in the ?secret= query string', async () => {
    const res = await POST(new Request(`https://app.test/api/admin/sanity/event-sync?secret=${SECRET}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: body(),
    }))
    expect(res.status).toBe(403)
  })

  it('accepts the secret supplied in the x-webhook-secret header', async () => {
    const res = await POST(new Request('https://app.test/api/admin/sanity/event-sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': SECRET },
      body: body(),
    }))
    expect(res.status).toBe(200)
  })

  it('rejects a missing secret', async () => {
    const res = await POST(new Request('https://app.test/api/admin/sanity/event-sync', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: body(),
    }))
    expect(res.status).toBe(403)
  })
})

// One HubSpot portal, no sandbox: only the real production app may change the
// CRM's option lists, whichever deployment Sanity's webhook happens to reach.
describe('POST /api/admin/sanity/event-sync — HubSpot option sync', () => {
  function publish() {
    return POST(new Request('https://app.test/api/admin/sanity/event-sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': SECRET },
      body: body(),
    }))
  }

  afterEach(() => { hubspot.isProd = false; hubspot.sync.mockClear() })

  it('skips the sync off the production app', async () => {
    const res = await publish()
    const json = await res.json()
    expect(hubspot.sync).not.toHaveBeenCalled()
    expect(json.hubspotOptions).toMatch(/skipped/)
  })

  it('applies the sync on the production app and reports what changed', async () => {
    hubspot.isProd = true
    const res = await publish()
    const json = await res.json()
    expect(hubspot.sync).toHaveBeenCalledWith({ apply: true, stellrOnlyDb: expect.anything() })
    expect(json.hubspotOptions).toMatchObject({ ok: true, updated: ['contacts.event'] })
  })

  it('does not fail the webhook when the sync throws', async () => {
    hubspot.isProd = true
    hubspot.sync.mockRejectedValueOnce(new Error('HubSpot down'))
    const res = await publish()
    expect(res.status).toBe(200)
    expect((await res.json()).hubspotOptions).toBe('error')
  })
})

describe('POST /api/admin/sanity/event-sync — events mirror (S3)', () => {
  function publish() {
    return POST(new Request('https://app.test/api/admin/sanity/event-sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': SECRET },
      body: body(),
    }))
  }

  afterEach(() => { mirror.sync.mockClear() })

  it('mirrors the published event by its Sanity _id and reports the outcome', async () => {
    const res = await publish()
    expect(res.status).toBe(200)
    expect(mirror.sync).toHaveBeenCalledWith(expect.anything(), { sanityId: 'doc1', slug: 'co-sdc' })
    expect((await res.json()).mirror).toBe('synced')
  })

  it('still answers 200 with the rest of the sync when the mirror reports an error', async () => {
    mirror.sync.mockResolvedValueOnce({ status: 'error' })
    const res = await publish()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true, slug: 'co-sdc', mirror: 'error', containerId: 'c1' })
  })

  it('does not fail the webhook even if the mirror throws', async () => {
    mirror.sync.mockRejectedValueOnce(new Error('mirror down'))
    const res = await publish()
    expect(res.status).toBe(200)
    expect((await res.json()).mirror).toBe('error')
  })

  it('is not called for a refused request', async () => {
    const res = await POST(new Request('https://app.test/api/admin/sanity/event-sync', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: body(),
    }))
    expect(res.status).toBe(403)
    expect(mirror.sync).not.toHaveBeenCalled()
  })
})
