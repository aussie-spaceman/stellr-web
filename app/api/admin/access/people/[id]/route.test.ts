// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review AUTH-6: granting or removing a member's global role changes what
// they can reach platform-wide; record who did it.

const h = vi.hoisted(() => ({ addOk: { ok: true } as { ok: boolean; reason?: string } }))
const logActivity = vi.fn()
const addGlobalRole = vi.fn()

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ sessionClaims: { metadata: { role: 'admin' } } }),
}))
vi.mock('@/lib/admin-auth', () => ({ isAdminClaims: () => true }))
vi.mock('@/lib/member-roles', () => ({
  addGlobalRole: (...a: unknown[]) => addGlobalRole(...a),
  getGlobalRoleNames: async () => [],
  ROLES_BY_BRACKET: {},
}))
vi.mock('@/lib/member-access', () => ({ getMemberAccessSummary: async () => ({ rows: [] }) }))
vi.mock('@/lib/tiers', () => ({ TIERS_BY_BRACKET: {} }))
vi.mock('@/lib/activity-log', () => ({
  logActivity: (...a: unknown[]) => logActivity(...a),
  actorFromAuth: async () => ({ actorType: 'admin', actorMemberId: 'admin1' }),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => {
      const chain: Record<string, unknown> = { delete: () => chain, eq: () => chain }
      return chain
    },
  }),
}))

const { POST, DELETE } = await import('./route')
const params = Promise.resolve({ id: 'member-99' })

beforeEach(() => {
  logActivity.mockReset()
  addGlobalRole.mockReset()
  addGlobalRole.mockResolvedValue({ ok: true })
  h.addOk = { ok: true }
})

describe('POST /api/admin/access/people/[id]', () => {
  it('logs role_granted after a successful grant (AUTH-6)', async () => {
    const res = await POST(new Request('https://app.test/x', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'mentor' }),
    }), { params })
    expect(res.status).toBe(200)
    expect(logActivity.mock.calls[0][0]).toMatchObject({ memberId: 'member-99', action: 'role_granted', metadata: { role: 'mentor' } })
  })

  it('does not log when the grant is rejected', async () => {
    addGlobalRole.mockResolvedValue({ ok: false, reason: 'not allowed' })
    const res = await POST(new Request('https://app.test/x', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'mentor' }),
    }), { params })
    expect(res.status).toBe(400)
    expect(logActivity).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/admin/access/people/[id]', () => {
  it('logs role_removed after a successful revoke (AUTH-6)', async () => {
    const res = await DELETE(new Request('https://app.test/x', {
      method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'mentor' }),
    }), { params })
    expect(res.status).toBe(200)
    expect(logActivity.mock.calls[0][0]).toMatchObject({ memberId: 'member-99', action: 'role_removed', metadata: { role: 'mentor' } })
  })
})
