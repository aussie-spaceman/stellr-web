// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review AUTH-6: granting or revoking staff function scopes must be audited
// (who set them, to what), like the rest of the admin surface.

const h = vi.hoisted(() => ({
  member: { id: 'm1', first_name: 'A', last_name: 'B', email: 'a@b.c' } as Record<string, unknown> | null,
  dbError: null as unknown,
}))
const logActivity = vi.fn()

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ sessionClaims: { metadata: { role: 'admin' } } }),
}))
vi.mock('@/lib/community', () => ({ getSignedInMember: async () => ({ id: 'admin1' }) }))
vi.mock('@/lib/activity-log', () => ({
  logActivity: (...a: unknown[]) => logActivity(...a),
  actorFromAuth: async () => ({ actorType: 'admin', actorMemberId: 'admin1' }),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      if (table === 'staff_roles') {
        return {
          upsert: async () => ({ error: h.dbError }),
          delete: () => ({ eq: async () => ({ error: h.dbError }) }),
        }
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        ilike: () => chain,
        maybeSingle: async () => ({ data: h.member }),
      }
      return chain
    },
  }),
}))

const { POST, DELETE } = await import('./route')

beforeEach(() => {
  logActivity.mockReset()
  h.member = { id: 'm1', first_name: 'A', last_name: 'B', email: 'a@b.c' }
  h.dbError = null
})

describe('POST /api/admin/staff-roles', () => {
  it('logs staff_scopes_set after a successful grant (AUTH-6)', async () => {
    const res = await POST(new Request('https://app.test/api/admin/staff-roles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memberId: 'm1', scopes: ['events', 'community'] }),
    }))
    expect(res.status).toBe(200)
    expect(logActivity).toHaveBeenCalledOnce()
    expect(logActivity.mock.calls[0][0]).toMatchObject({
      memberId: 'm1',
      action: 'staff_scopes_set',
      metadata: { scopes: ['events', 'community'] },
    })
  })

  it('does not log when the upsert fails', async () => {
    h.dbError = { message: 'boom' }
    const res = await POST(new Request('https://app.test/api/admin/staff-roles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memberId: 'm1', scopes: ['events'] }),
    }))
    expect(res.status).toBe(500)
    expect(logActivity).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/admin/staff-roles', () => {
  it('logs staff_scopes_removed after a successful revoke (AUTH-6)', async () => {
    const res = await DELETE(new Request('https://app.test/api/admin/staff-roles', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memberId: 'm1' }),
    }))
    expect(res.status).toBe(200)
    expect(logActivity.mock.calls[0][0]).toMatchObject({ memberId: 'm1', action: 'staff_scopes_removed' })
  })
})
