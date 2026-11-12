// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { TENANT_ID_HEADER, TENANT_ROUTING_FLAG, TENANT_SLUG_HEADER } from '@/lib/tenancy/host'

// deep review INT-10 / PUB-6: the opt-out must not happen on a GET (K-12 Safe
// Links / Mimecast scanners fetch every URL on delivery and would silently
// unsubscribe teachers). GET shows a confirm page; POST performs the change.
// The echoed member email must be HTML-escaped.

const host = vi.hoisted(() => ({ headers: new Headers() }))
vi.mock('next/headers', () => ({ headers: async () => host.headers }))

const memberUpdate = vi.fn(async (_payload: Record<string, unknown>) => ({ error: null }))
let memberRow: { id: string; email: string | null } | null = null

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: memberRow }) }) }),
      update: (payload: Record<string, unknown>) => {
        memberUpdate(payload)
        return { eq: async () => ({ error: null }) }
      },
    }),
  }),
}))
const upsertContact = vi.hoisted(() => vi.fn(async (_c: unknown) => ({ ok: true })))
vi.mock('@/lib/hubspot', () => ({ upsertContact }))
vi.mock('@/lib/audit/route', () => ({ auditMutation: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/waitlist-optout', () => ({ verifyOptOutToken: () => true }))

const { GET, POST } = await import('./route')

const url = (qs: string) => `http://localhost/api/email/unsubscribe${qs}`

beforeEach(() => {
  host.headers = new Headers()
  vi.unstubAllEnvs()
  upsertContact.mockClear()
  memberUpdate.mockClear()
  memberRow = { id: 'm1', email: 'teacher@example.org' }
})

describe('member marketing opt-out', () => {
  it('GET does NOT change state — it renders a POST confirm form', async () => {
    const res = await GET(new NextRequest(url('?token=tok123')))
    const body = await res.text()
    expect(memberUpdate).not.toHaveBeenCalled()
    expect(body).toContain('<form method="POST"')
    expect(body).toContain('name="token"')
  })

  it('POST flips marketing_consent to false', async () => {
    const res = await POST(new NextRequest(url('?token=tok123'), { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(memberUpdate).toHaveBeenCalledTimes(1)
    expect(memberUpdate.mock.calls[0][0]).toMatchObject({ marketing_consent: false })
  })

  it('escapes the echoed member email in the confirmation page', async () => {
    memberRow = { id: 'm1', email: '<b>x</b>@evil.test' }
    const res = await POST(new NextRequest(url('?token=tok123'), { method: 'POST' }))
    const body = await res.text()
    expect(body).not.toContain('<b>x</b>@evil.test')
    expect(body).toContain('&lt;b&gt;x&lt;/b&gt;@evil.test')
  })
})

// S5 wave 7, A10b: both lists are Stellr's own, so another tenant's host acts on
// neither. A link used there gets the neutral answer an unknown link gets: no address
// echoed, no member updated, nothing sent to HubSpot.
describe("another tenant's host", () => {
  const onCanaryHost = () => {
    vi.stubEnv(TENANT_ROUTING_FLAG, 'true')
    host.headers = new Headers({ [TENANT_ID_HEADER]: 'c0000000-0000-4000-8000-0000000000aa', [TENANT_SLUG_HEADER]: 'canary' })
  }

  it('answers a member link as an unknown one: no address, no write', async () => {
    onCanaryHost()
    const res = await POST(new NextRequest(url('?token=tok123'), { method: 'POST' }))
    const body = await res.text()
    expect(res.status).toBe(200)
    expect(body).toContain('You have been unsubscribed from marketing emails.')
    expect(body).not.toContain('teacher@example.org')
    expect(memberUpdate).not.toHaveBeenCalled()
  })

  it('answers a waitlist link with the neutral confirmation, and writes nothing to HubSpot', async () => {
    onCanaryHost()
    const res = await POST(new NextRequest(url('?wl=sig&e=lead%40example.org'), { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('You will no longer receive event registration updates from Stellr Education.')
    expect(upsertContact).not.toHaveBeenCalled()
  })

  it("on Stellr's host, with routing on, both go ahead as before", async () => {
    vi.stubEnv(TENANT_ROUTING_FLAG, 'true')
    const res = await POST(new NextRequest(url('?token=tok123'), { method: 'POST' }))
    expect(await res.text()).toContain('teacher@example.org will no longer receive marketing emails')
    expect(memberUpdate).toHaveBeenCalledTimes(1)
    await POST(new NextRequest(url('?wl=sig&e=lead%40example.org'), { method: 'POST' }))
    expect(upsertContact).toHaveBeenCalledTimes(1)
  })
})
