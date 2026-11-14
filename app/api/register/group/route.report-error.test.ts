// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// S1 monitoring: a group registration that fails with a 500 the route answers
// itself never reaches Next's onRequestError, so the route reports it to
// app_errors (lib/app-errors reportError) under the fixed label. Each persist
// step is covered, and the outer catch. The response is unchanged.

const h = vi.hoisted(() => ({
  reportError: vi.fn(async (_err: unknown, _opts: { route: string }) => {}),
  insertRegistration: vi.fn(),
  saveMembers: vi.fn(),
  insertParticipants: vi.fn(),
  memberHooks: vi.fn(),
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
vi.mock('@/lib/registration/group/gate', () => ({
  gateGroupRegistration: async () => ({ ok: true, group: { context: { tenantId: STELLR_TENANT_ID } } }),
}))
vi.mock('@/lib/registration/group/persist', () => ({
  insertGroupRegistration: h.insertRegistration,
  saveGroupMembers: h.saveMembers,
  insertGroupParticipants: h.insertParticipants,
  linkRegistrantMember: async () => {},
}))
vi.mock('@/lib/registration/group/stellr-hooks', () => ({
  runGroupMemberHooks: h.memberHooks,
  provisionRegistrantLogin: async () => null,
  scheduleGroupFollowUp: () => {},
}))
vi.mock('@/lib/registration/group/respond', () => ({ respondToGroupRegistration: h.respond }))

const { POST } = await import('./route')

const ROUTE = 'POST /api/register/group'
const post = () =>
  POST(new Request('https://www.example.test/api/register/group', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event_slug: 'some-event', students: [], additional_adults: [] }),
  }) as never)
const fail500 = (error: string) => ({ ok: false, response: Response.json({ error }, { status: 500 }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  h.insertRegistration.mockResolvedValue({ ok: true, registration: { regId: 'reg-1' } })
  h.saveMembers.mockResolvedValue({ ok: true, members: {} })
  h.insertParticipants.mockResolvedValue({ ok: true, participants: [] })
  h.memberHooks.mockResolvedValue(undefined)
  h.respond.mockResolvedValue(Response.json({ registrationId: 'reg-1' }, { status: 201 }))
})

describe('POST /api/register/group reports its own 500s', () => {
  it.each([
    ['the registration insert', () => h.insertRegistration.mockResolvedValue(fail500('Failed to create registration')), 'Failed to create registration'],
    ['the members step', () => h.saveMembers.mockResolvedValue(fail500('Failed to save members')), 'Failed to save members'],
    ['the participants insert', () => h.insertParticipants.mockResolvedValue(fail500('Failed to save participant details')), 'Failed to save participant details'],
  ])('%s: reported under the fixed label, the 500 sent unchanged', async (_what, arrange, error) => {
    arrange()
    const res = await post()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error })
    expect(h.reportError).toHaveBeenCalledTimes(1)
    const [err, opts] = h.reportError.mock.calls[0]
    expect((err as Error).message).toBe(`HTTP 500: ${error}`)
    expect(opts).toEqual({ route: ROUTE })
  })

  it('a refusal (4xx) is not an error', async () => {
    h.insertRegistration.mockResolvedValue({ ok: false, response: Response.json({ error: 'Event full' }, { status: 409 }) })
    expect((await post()).status).toBe(409)
    expect(h.reportError).not.toHaveBeenCalled()
  })

  it('a throw: reported with the error itself, the generic 500 sent unchanged', async () => {
    const boom = new Error('member hooks blew up')
    h.memberHooks.mockRejectedValue(boom)
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
