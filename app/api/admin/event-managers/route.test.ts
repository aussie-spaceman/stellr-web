// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review AUTH-6: an event-manager assignment grants access to an event's
// roster (minors' details, medical notes, background summaries). Who granted or
// revoked it must be recoverable, so both paths write an audit entry.

const h = vi.hoisted(() => ({ dbError: null as unknown }))
const logActivity = vi.fn()
const memberIdForClerkUser = vi.fn()

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ sessionClaims: { metadata: { role: 'admin' } } }),
  clerkClient: async () => ({ users: { getUserList: async () => ({ data: [] }) } }),
}))
vi.mock('@/lib/admin-auth', () => ({ isAdminClaims: () => true }))
vi.mock('@/lib/activity-log', () => ({
  logActivity: (...a: unknown[]) => logActivity(...a),
  actorFromAuth: async () => ({ actorType: 'admin', actorMemberId: 'admin1' }),
}))
vi.mock('@/lib/deletion/actor', () => ({
  memberIdForClerkUser: (...a: unknown[]) => memberIdForClerkUser(...a),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => ({
      upsert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'a1' }, error: h.dbError }) }) }),
      delete: () => ({ eq: () => ({ eq: async () => ({ error: h.dbError }) }) }),
    }),
  }),
}))

const { POST, DELETE } = await import('./route')

beforeEach(() => {
  logActivity.mockReset()
  memberIdForClerkUser.mockReset()
  memberIdForClerkUser.mockResolvedValue('target-member-1')
  h.dbError = null
})

describe('POST /api/admin/event-managers', () => {
  it('logs event_manager_assigned against the resolved member (AUTH-6)', async () => {
    const res = await POST(new Request('https://app.test/api/admin/event-managers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clerk_user_id: 'user_em', event_slug: 'co-sdc' }),
    }))
    expect(res.status).toBe(201)
    expect(logActivity.mock.calls[0][0]).toMatchObject({
      memberId: 'target-member-1',
      action: 'event_manager_assigned',
      metadata: { event_slug: 'co-sdc', clerk_user_id: 'user_em' },
    })
  })
})

describe('DELETE /api/admin/event-managers', () => {
  it('logs event_manager_unassigned (AUTH-6)', async () => {
    const res = await DELETE(new Request('https://app.test/api/admin/event-managers', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clerk_user_id: 'user_em', event_slug: 'co-sdc' }),
    }))
    expect(res.status).toBe(200)
    expect(logActivity.mock.calls[0][0]).toMatchObject({
      action: 'event_manager_unassigned',
      metadata: { event_slug: 'co-sdc', clerk_user_id: 'user_em' },
    })
  })
})
