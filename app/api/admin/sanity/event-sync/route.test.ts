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
