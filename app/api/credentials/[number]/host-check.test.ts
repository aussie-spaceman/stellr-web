// @vitest-environment node
//
// S5 wave 7, A10a: the credential routes refuse another host's credential before any
// other check. Here every other check passes (the signed-in member owns the credential,
// the family-link token is good), so the host check is the only thing that can answer
// 404, and nothing past it may run: no PDF, no visibility change, no credential event.
// Both directions, with the NULL row that is Stellr's. The events route has its own
// cases in test/idor (the honey_write cases); these are the three it cannot tell apart.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID as STELLR } from '@/lib/tenancy/constants'
import { TENANT_ID_HEADER, TENANT_ROUTING_FLAG, TENANT_SLUG_HEADER } from '@/lib/tenancy/host'
import { fakeChainDb } from '@/test/helpers/fake-chain-db'

const CANARY = 'c0000000-0000-4000-8000-0000000000aa'
const MEMBER = 'm-owner'

const h = vi.hoisted(() => ({
  headers: new Headers(),
  cred: null as Record<string, unknown> | null,
  render: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
  recordEvent: vi.fn(async () => {}),
  setVisibility: vi.fn(async () => ({ ok: true, row: { visibility: 'private' } })),
}))

vi.mock('next/headers', () => ({ headers: async () => h.headers }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => fakeChainDb(() => ({ data: [], error: null })).db }))
vi.mock('@/lib/community', () => ({ getCurrentMember: async () => ({ id: MEMBER }), signedDownloadUrl: async () => null }))
vi.mock('@/lib/credentials', () => ({
  getCredentialByNumber: async () => h.cred,
  recordCredentialEvent: h.recordEvent,
  shareConsentFor: async () => 'not_required',
  setVisibility: h.setVisibility,
}))
vi.mock('@/lib/credential-pdf', () => ({ renderCredentialPdf: h.render }))
vi.mock('@/lib/survey/certificate-gate', () => ({ certificateGateFor: async () => ({ gated: false }), certificateGate: () => ({ gated: false }) }))
vi.mock('@/lib/after-response', () => ({ runAfterResponse: (_label: string, fn: () => unknown) => fn() }))
vi.mock('@/lib/rate-limit-async', () => ({ rateLimit: async () => null }))
vi.mock('@/lib/credentials-link', () => ({ FAMILY_LINK_PARAM: 'k', verifyCredentialPdfToken: (_id: string, token: string | null) => token === 'good' }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
// The audit wrapper is tested on its own; here it only passes the call through.
vi.mock('@/lib/audit/route', () => ({ withAudit: (_spec: unknown, fn: unknown) => fn }))
vi.mock('@/lib/audit/route-subject', () => ({ auditSubject: () => ({}), noteAuditSubject: () => {} }))

const pdf = await import('./pdf/route')
const visibility = await import('./visibility/route')
const certificate = await import('./certificate/route')

/** A credential the signed-in member holds, with every check past the host's passing. */
function held(tenant: string | null) {
  return {
    id: 'cred-1', number: 'STL-2026-AAAAAAAA', source: 'event', event_slug: 'the-event', module_id: null,
    member_id: MEMBER, participant_id: null, owner_member_id: MEMBER, status: 'issued', tombstoned_at: null,
    tenant_id: tenant,
  }
}

const ctx = { params: Promise.resolve({ number: 'STL-2026-AAAAAAAA' }) }
const URL_BASE = 'https://app.example.test/api/credentials/STL-2026-AAAAAAAA'

const ROUTES = {
  pdf: () => pdf.GET(new Request(`${URL_BASE}/pdf`), ctx),
  visibility: () =>
    visibility.POST(
      new Request(`${URL_BASE}/visibility`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ visibility: 'private' }) }),
      ctx,
    ),
  certificate: () => certificate.GET(new Request(`${URL_BASE}/certificate?k=good`), ctx),
}

/** Did the route act on the credential: render it, record an event, or change it? */
const acted = () => h.render.mock.calls.length + h.recordEvent.mock.calls.length + h.setVisibility.mock.calls.length

function onCanaryHost() {
  vi.stubEnv(TENANT_ROUTING_FLAG, 'true')
  h.headers = new Headers({ [TENANT_ID_HEADER]: CANARY, [TENANT_SLUG_HEADER]: 'canary' })
}

beforeEach(() => {
  h.headers = new Headers()
  h.render.mockClear()
  h.recordEvent.mockClear()
  h.setVisibility.mockClear()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe.each(Object.entries(ROUTES))('%s: the host check', (_name, call) => {
  it("refuses another tenant's credential on Stellr's host, as a number nobody holds, before anything acts on it", async () => {
    h.cred = held(CANARY)
    const res = await call()
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
    expect(acted()).toBe(0)
  })

  it("serves Stellr's credential, a NULL tenant included, on Stellr's host with the flag off", async () => {
    for (const tenant of [STELLR, null]) {
      h.cred = held(tenant)
      expect((await call()).status).toBe(200)
    }
    expect(acted()).toBeGreaterThan(0)
  })

  it("refuses Stellr's credential, a NULL tenant included, on another tenant's host, and serves that tenant's own", async () => {
    onCanaryHost()
    for (const tenant of [STELLR, null]) {
      h.cred = held(tenant)
      expect((await call()).status).toBe(404)
    }
    expect(acted()).toBe(0)
    h.cred = held(CANARY)
    expect((await call()).status).toBe(200)
  })
})
