// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// S1 monitoring: a registration that fails with a 500 the route answers itself
// never reaches Next's onRequestError, so the route reports it to app_errors
// (lib/app-errors reportError) under the fixed label, never a concrete path.
// The response the registrant sees is unchanged.

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
vi.mock('@/lib/rate-limit-async', () => ({ rateLimit: async () => null }))
vi.mock('@/lib/tenancy/request-tenant', () => ({ requestTenant: async () => ({ tenantId: STELLR_TENANT_ID }) }))
vi.mock('@/lib/audit/route', () => ({ auditMutation: async () => {} }))
vi.mock('@/lib/registration/individual/gate', () => ({
  gateIndividualRegistration: async () => ({ ok: true, registration: { context: { tenantId: STELLR_TENANT_ID } } }),
}))
vi.mock('@/lib/registration/individual/persist', () => ({ persistIndividualRegistration: h.persist }))
vi.mock('@/lib/registration/individual/stellr-hooks', () => ({ runIndividualHooks: h.hooks }))
vi.mock('@/lib/registration/individual/respond', () => ({ respondToIndividualRegistration: h.respond }))

const { POST } = await import('./route')

const ROUTE = 'POST /api/register/individual'
const post = () =>
  POST(new Request('https://www.example.test/api/register/individual', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event_slug: 'some-event', email: 'family@example.test' }),
  }) as never)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  h.persist.mockResolvedValue({ ok: true, row: { regId: 'reg-1' } })
  h.hooks.mockResolvedValue({})
  h.respond.mockResolvedValue(Response.json({ registrationId: 'reg-1' }, { status: 201 }))
})

describe('POST /api/register/individual reports its own 500s', () => {
  it('a failed insert: reported under the fixed label, the 500 sent unchanged', async () => {
    h.persist.mockResolvedValue({ ok: false, response: Response.json({ error: 'Failed to create registration' }, { status: 500 }) })
    const res = await post()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to create registration' })
    expect(h.reportError).toHaveBeenCalledTimes(1)
    const [err, opts] = h.reportError.mock.calls[0]
    expect((err as Error).message).toBe('HTTP 500: Failed to create registration')
    expect(opts).toEqual({ route: ROUTE })
  })

  it('a refusal (4xx) is not an error', async () => {
    h.persist.mockResolvedValue({ ok: false, response: Response.json({ error: 'Already registered' }, { status: 409 }) })
    expect((await post()).status).toBe(409)
    expect(h.reportError).not.toHaveBeenCalled()
  })

  it('a throw: reported with the error itself, the generic 500 sent unchanged', async () => {
    const boom = new Error('hooks blew up')
    h.hooks.mockRejectedValue(boom)
    const res = await post()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
    expect(h.reportError).toHaveBeenCalledWith(boom, { route: ROUTE })
  })

  it('a registration that succeeds reports nothing', async () => {
    expect((await post()).status).toBe(201)
    expect(h.reportError).not.toHaveBeenCalled()
  })
})
