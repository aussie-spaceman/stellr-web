// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review QUAL-1: the impersonation audit row is a safeguarding control (an
// adult viewing a minor's portal). It must be AWAITED so a frozen instance
// cannot drop it after the response is sent.

const h = vi.hoisted(() => ({
  member: { id: 'm1', first_name: 'A', last_name: 'B', email: 'a@b.c' } as Record<string, unknown> | null,
}))
const logActivity = vi.fn()

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: 'admin-clerk', sessionClaims: { metadata: { role: 'admin' } } }),
}))
vi.mock('@/lib/admin-auth', () => ({ isAdminClaims: () => true }))
vi.mock('@/lib/impersonation', () => ({
  encodeTicket: () => 'ticket-abc',
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

const { POST } = await import('./route')

beforeEach(() => { logActivity.mockReset() })

function post() {
  return POST(new Request('https://app.test/api/admin/impersonation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ memberId: 'm1' }),
  }))
}

describe('POST /api/admin/impersonation', () => {
  it('awaits the audit log before returning (a frozen instance cannot drop it)', async () => {
    let settled = false
    logActivity.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5))
      settled = true
    })
    const res = await post()
    expect(res.status).toBe(200)
    expect(settled, 'the audit insert had not settled when the response returned').toBe(true)
  })
})
