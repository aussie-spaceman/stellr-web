// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review QUAL-1: the impersonation audit row is a safeguarding control (an
// adult viewing a minor's portal). It must be AWAITED so a frozen instance
// cannot drop it after the response is sent.
//
// deep review AUTH-9: the POST refuses a target who is another platform admin,
// and the DELETE logs impersonation_ended so an access review sees both ends of
// the window.

const h = vi.hoisted(() => ({
  member: { id: 'm1', first_name: 'A', last_name: 'B', email: 'a@b.c', clerk_user_id: 'clerk_target' } as Record<string, unknown> | null,
  targetRole: undefined as string | undefined,
  cookieValue: undefined as string | undefined,
  decoded: null as { memberId: string; adminMemberId: string | null; issuedAt: number } | null,
}))
const logActivity = vi.fn()
const getUser = vi.fn()

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: 'admin-clerk', sessionClaims: { metadata: { role: 'admin' } } }),
  clerkClient: async () => ({ users: { getUser } }),
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (h.cookieValue ? { value: h.cookieValue } : undefined) }),
}))
vi.mock('@/lib/admin-auth', () => ({ isAdminClaims: () => true }))
vi.mock('@/lib/impersonation', () => ({
  encodeTicket: () => 'ticket-abc',
  decodeTicket: () => h.decoded,
  IMPERSONATION_COOKIE: 'imp',
  IMPERSONATION_TTL_SECONDS: 900,
}))
vi.mock('@/lib/activity-log', () => ({
  logActivity: (...a: unknown[]) => logActivity(...a),
  actorFromAuth: async () => ({ actorMemberId: 'admin1' }),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: h.member, error: null }),
      }
      return chain
    },
  }),
}))

const { POST, DELETE } = await import('./route')

beforeEach(() => {
  logActivity.mockReset()
  getUser.mockReset()
  getUser.mockResolvedValue({ publicMetadata: { role: h.targetRole } })
  h.member = { id: 'm1', first_name: 'A', last_name: 'B', email: 'a@b.c', clerk_user_id: 'clerk_target' }
  h.targetRole = undefined
  h.cookieValue = undefined
  h.decoded = null
})

function post() {
  return POST(new Request('https://app.test/api/admin/impersonation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ memberId: 'm1' }),
  }))
}

describe('POST /api/admin/impersonation', () => {
  it('awaits the audit log before returning (a frozen instance cannot drop it)', async () => {
    getUser.mockResolvedValue({ publicMetadata: {} })
    let settled = false
    logActivity.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5))
      settled = true
    })
    const res = await post()
    expect(res.status).toBe(200)
    expect(settled, 'the audit insert had not settled when the response returned').toBe(true)
  })

  it('refuses to view-as another platform admin (AUTH-9)', async () => {
    getUser.mockResolvedValue({ publicMetadata: { role: 'admin' } })
    const res = await post()
    expect(res.status).toBe(403)
    expect(logActivity).not.toHaveBeenCalled()
  })

  it('allows viewing a non-admin member', async () => {
    getUser.mockResolvedValue({ publicMetadata: { role: undefined } })
    const res = await post()
    expect(res.status).toBe(200)
  })
})

describe('DELETE /api/admin/impersonation', () => {
  it('logs impersonation_ended when a view-as cookie is present (AUTH-9)', async () => {
    h.cookieValue = 'ticket-abc'
    h.decoded = { memberId: 'm1', adminMemberId: 'admin1', issuedAt: Date.now() }
    const res = await DELETE()
    expect(res.status).toBe(200)
    expect(logActivity).toHaveBeenCalledOnce()
    expect(logActivity.mock.calls[0][0]).toMatchObject({ action: 'impersonation_ended', memberId: 'm1' })
  })

  it('does not log when there is no decodable ticket', async () => {
    h.cookieValue = undefined
    h.decoded = null
    const res = await DELETE()
    expect(res.status).toBe(200)
    expect(logActivity).not.toHaveBeenCalled()
  })
})
