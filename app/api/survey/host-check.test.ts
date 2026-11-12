// @vitest-environment node
//
// S5 wave 7, A10b: the emailed survey link's routes refuse another host's survey before
// any other check, so another host's link answers as one nobody holds: before the
// signed-in member is compared (a 403 would say the link exists) and before the body is
// read (a 400 would too). A Stellr link held by the wrong Stellr member keeps its 403.
// The QR page's "email me my link" sends only this host's survey. Both directions, with
// the NULL row that is Stellr's.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID as STELLR } from '@/lib/tenancy/constants'
import { TENANT_ID_HEADER, TENANT_ROUTING_FLAG, TENANT_SLUG_HEADER } from '@/lib/tenancy/host'
import { fakeChainDb, type ChainCall } from '@/test/helpers/fake-chain-db'

const CANARY = 'c0000000-0000-4000-8000-0000000000aa'
const TOKEN = 'A'.repeat(43)

const h = vi.hoisted(() => ({
  headers: new Headers(),
  inv: null as Record<string, unknown> | null,
  dist: null as Record<string, unknown> | null,
  wrongMember: false,
  wrongMemberAsked: 0,
  calls: [] as unknown[],
  sendLink: vi.fn(async () => true),
}))

vi.mock('next/headers', () => ({ headers: async () => h.headers }))
vi.mock('@/lib/rate-limit-async', () => ({ rateLimit: async () => null }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/community', () => ({ getSignedInMember: async () => ({ id: 'm-signed-in' }), getCurrentMember: async () => null }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => {
    const { db, calls } = fakeChainDb((call: ChainCall) => (call.table === 'survey_invitations' && call.op === 'select' ? { data: h.inv ? [h.inv] : [], error: null } : { data: [], error: null }))
    h.calls = calls
    return db
  },
}))
vi.mock('@/lib/survey/access', () => ({
  invitationByToken: async () => h.inv,
  invitationForMember: async () => null,
  isWrongMember: async () => {
    h.wrongMemberAsked++
    return h.wrongMember
  },
  // A survey that has closed and was never answered: the open answers with its state alone.
  loadSession: async (_db: unknown, inv: unknown) => ({ invitation: inv, state: 'closed', response: null }),
  openSession: async () => ({}),
  clientView: () => ({}),
  runtimeOptions: async () => ({}),
  saveDraft: async () => ({ ok: true, savedAt: 'now' }),
  submitResponse: async () => ({ ok: true, submittedAt: 'now' }),
}))
vi.mock('@/lib/survey/distributions', () => ({
  distributionForEvent: async () => h.dist,
  statusNow: () => 'open',
  loadDefinition: async () => ({ def: {} }),
}))
vi.mock('@/lib/survey/send', () => ({ sendLinkEmail: h.sendLink }))
// The audit wrapper is tested on its own; here it only passes the call through.
vi.mock('@/lib/audit/route', () => ({ withAudit: (_spec: unknown, fn: unknown) => fn }))

const token = await import('./[token]/route')
const submit = await import('./[token]/submit/route')
const stop = await import('./[token]/stop-reminders/route')
const link = await import('./event/[slug]/link/route')

const ctx = { params: Promise.resolve({ token: TOKEN }) }
const BASE = `https://app.example.test/api/survey/${TOKEN}`
const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const ROUTES = {
  'GET (open)': () => token.GET(new Request(BASE), ctx),
  'PATCH (save)': () => token.PATCH(new Request(BASE, { ...json({ answers: 'not an object' }), method: 'PATCH' }), ctx),
  'POST submit': () => submit.POST(new Request(`${BASE}/submit`, json({ answers: 'not an object' })), ctx),
}

const invitation = (tenant: string | null) => ({ id: 'inv-1', distribution_id: 'd-1', status: 'sent', reminders_opted_out_at: null, tenant_id: tenant })
const writes = () => (h.calls as ChainCall[]).filter((c) => c.op !== 'select')

function onCanaryHost() {
  vi.stubEnv(TENANT_ROUTING_FLAG, 'true')
  h.headers = new Headers({ [TENANT_ID_HEADER]: CANARY, [TENANT_SLUG_HEADER]: 'canary' })
}

beforeEach(() => {
  h.headers = new Headers()
  h.wrongMember = false
  h.wrongMemberAsked = 0
  h.calls = []
  h.sendLink.mockClear()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe.each(Object.entries(ROUTES))('%s: the host check', (_name, call) => {
  it("answers another tenant's link on Stellr's host as an unknown link, before the member or the body is looked at", async () => {
    h.inv = invitation(CANARY)
    h.wrongMember = true
    const res = await call()
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'This survey link isn’t valid.' })
    expect(h.wrongMemberAsked).toBe(0)
  })

  it('keeps the 403 for a Stellr link, a NULL tenant included, held by the wrong Stellr member', async () => {
    h.wrongMember = true
    for (const tenant of [STELLR, null]) {
      h.inv = invitation(tenant)
      const res = await call()
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'This survey link belongs to someone else. Sign out, or use your own link.' })
    }
  })

  it("serves Stellr's link to its holder, a NULL tenant included, with the flag off", async () => {
    for (const tenant of [STELLR, null]) {
      h.inv = invitation(tenant)
      expect((await call()).status).not.toBe(404)
    }
    expect(h.wrongMemberAsked).toBe(2)
  })

  it("refuses Stellr's link, a NULL tenant included, on another tenant's host, and serves that tenant's own", async () => {
    onCanaryHost()
    h.wrongMember = true
    for (const tenant of [STELLR, null]) {
      h.inv = invitation(tenant)
      expect((await call()).status).toBe(404)
    }
    expect(h.wrongMemberAsked).toBe(0)
    h.inv = invitation(CANARY)
    expect((await call()).status).toBe(403)
  })
})

describe('stop-reminders: the host check', () => {
  const stopNow = () => stop.POST(new Request(`${BASE}/stop-reminders`, { method: 'POST' }), ctx)

  it("answers another tenant's link on Stellr's host as an unknown one, and stops nothing", async () => {
    h.inv = invitation(CANARY)
    const res = await stopNow()
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'This link isn’t valid.' })
    expect(writes()).toEqual([])
  })

  it("stops Stellr's reminders as before, a NULL tenant included", async () => {
    for (const tenant of [STELLR, null]) {
      h.inv = invitation(tenant)
      const res = await stopNow()
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
      expect(writes()).toHaveLength(1)
    }
  })

  it("refuses Stellr's link on another tenant's host, and stops that tenant's own", async () => {
    onCanaryHost()
    h.inv = invitation(null)
    expect((await stopNow()).status).toBe(404)
    expect(writes()).toEqual([])
    h.inv = invitation(CANARY)
    expect((await stopNow()).status).toBe(200)
    expect(writes()).toHaveLength(1)
  })
})

describe('"email me my link": only this host’s survey sends', () => {
  const ask = () =>
    link.POST(new Request('https://app.example.test/api/survey/event/the-event/link', json({ email: 'sam@example.test' })), { params: Promise.resolve({ slug: 'the-event' }) })
  const distribution = (tenant: string | null) => ({ id: 'd-1', definition_id: 'def-1', tenant_id: tenant })

  it("sends nothing for another tenant's survey on Stellr's host, with the same answer", async () => {
    h.dist = distribution(CANARY)
    h.inv = invitation(CANARY)
    const res = await ask()
    expect(await res.json()).toEqual({ ok: true })
    expect(h.sendLink).not.toHaveBeenCalled()
  })

  it("sends Stellr's, a NULL tenant included, as before", async () => {
    for (const tenant of [STELLR, null]) {
      h.dist = distribution(tenant)
      h.inv = invitation(tenant)
      expect(await (await ask()).json()).toEqual({ ok: true })
    }
    expect(h.sendLink).toHaveBeenCalledTimes(2)
  })

  it("sends nothing for Stellr's survey on another tenant's host, and sends that tenant's own", async () => {
    onCanaryHost()
    h.dist = distribution(null)
    h.inv = invitation(null)
    await ask()
    expect(h.sendLink).not.toHaveBeenCalled()
    h.dist = distribution(CANARY)
    h.inv = invitation(CANARY)
    await ask()
    expect(h.sendLink).toHaveBeenCalledTimes(1)
  })

  it('answers the same when there is no survey at all', async () => {
    h.dist = null
    expect(await (await ask()).json()).toEqual({ ok: true })
    expect(h.sendLink).not.toHaveBeenCalled()
  })
})
