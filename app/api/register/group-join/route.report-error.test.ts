// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// S1 monitoring: a join whose participant insert fails is answered with the
// persist step's own 500, which never reaches Next's onRequestError, so the
// route reports it to app_errors (lib/app-errors reportError) under the fixed
// label. This handler has no catch of its own: a throw reaches Next, which
// records it through onRequestError, so the route does not report it twice.

const h = vi.hoisted(() => ({
  reportError: vi.fn(async (_err: unknown, _opts: { route: string }) => {}),
  persist: vi.fn(),
  hooks: vi.fn(),
  respond: vi.fn(),
}))

vi.mock('@/lib/app-errors', async (orig) => ({ ...(await orig<typeof import('@/lib/app-errors')>()), reportError: h.reportError }))
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: null }) }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({}) }))
vi.mock('@/lib/events/repo', () => ({ getEventBySlug: async () => null }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/rate-limit-async', () => ({ rateLimit: async () => null }))
vi.mock('@/lib/tenancy/request-tenant', () => ({ requestTenant: async () => ({ tenantId: STELLR_TENANT_ID }) }))
vi.mock('@/lib/audit/route', () => ({ auditMutation: async () => {} }))
vi.mock('@/lib/registration/group-join/gate', () => ({
  gateGroupJoinLink: async () => ({
    ok: true,
    link: { owner: { confirm: async () => ({ ok: true, context: { tenantId: STELLR_TENANT_ID } }) } },
  }),
}))
vi.mock('@/lib/registration/group-join/identify', () => ({
  identifyNewParticipant: async () => ({ ok: true, joiner: {} }),
  identifySignedInMember: async () => ({ ok: true, joiner: {} }),
}))
vi.mock('@/lib/registration/group-join/persist', () => ({ persistGroupJoin: h.persist }))
vi.mock('@/lib/registration/group-join/stellr-hooks', () => ({ runGroupJoinHooks: h.hooks }))
vi.mock('@/lib/registration/group-join/respond', () => ({ respondToGroupJoin: h.respond }))

const { POST } = await import('./route')

const ROUTE = 'POST /api/register/group-join'
const post = () =>
  POST(new Request('https://www.example.test/api/register/group-join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'join-token-placeholder', details: {} }),
  }) as never)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  h.persist.mockResolvedValue({ ok: true, participantId: 'p-1' })
  h.hooks.mockResolvedValue(undefined)
  h.respond.mockResolvedValue(Response.json({ ok: true }, { status: 201 }))
})

describe('POST /api/register/group-join reports its own 500s', () => {
  it('a failed participant insert: reported under the fixed label, the 500 sent unchanged', async () => {
    const error = 'Failed to complete registration. Please try again.'
    h.persist.mockResolvedValue({ ok: false, response: Response.json({ error }, { status: 500 }) })
    const res = await post()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error })
    expect(h.reportError).toHaveBeenCalledTimes(1)
    const [err, opts] = h.reportError.mock.calls[0]
    expect((err as Error).message).toBe(`HTTP 500: ${error}`)
    expect(opts).toEqual({ route: ROUTE })
  })

  it('a refusal (4xx) is not an error', async () => {
    h.persist.mockResolvedValue({ ok: false, response: Response.json({ error: 'You are already registered in this group.' }, { status: 409 }) })
    expect((await post()).status).toBe(409)
    expect(h.reportError).not.toHaveBeenCalled()
  })

  it('a throw still reaches Next (onRequestError records it), not reported twice here', async () => {
    h.hooks.mockRejectedValue(new Error('hooks blew up'))
    await expect(post()).rejects.toThrow('hooks blew up')
    expect(h.reportError).not.toHaveBeenCalled()
  })

  it('a join that succeeds reports nothing', async () => {
    expect((await post()).status).toBe(201)
    expect(h.reportError).not.toHaveBeenCalled()
  })
})
