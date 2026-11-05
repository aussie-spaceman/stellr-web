// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// deep review AUTH-6: an event-manager assignment grants access to an event's
// roster (minors' details, medical notes, background summaries). Who granted or
// revoked it must be recoverable, so both paths write an audit entry.
//
// S5 C9: each path also keeps the person's one Stellr event_manager membership in
// step. A failure there must not fail the action, and must be visible.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
}))
const logActivity = vi.fn()
const memberIdForClerkUser = vi.fn()
const captureRequestError = vi.fn()

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
vi.mock('@/lib/app-errors', () => ({
  captureRequestError: (...a: unknown[]) => captureRequestError(...a),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => h.db.client,
}))

const { POST, DELETE } = await import('./route')

function seed(failOn?: (table: string, action: string) => string | null) {
  h.db = fakeSupabase({}, { failOn })
}

const assign = (slug = 'co-sdc') =>
  POST(new Request('https://app.test/api/admin/event-managers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clerk_user_id: 'user_em', event_slug: slug }),
  }))
const unassign = (slug = 'co-sdc') =>
  DELETE(new Request('https://app.test/api/admin/event-managers', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clerk_user_id: 'user_em', event_slug: slug }),
  }))

const failMemberships = (table: string) => (table === 'tenant_memberships' ? 'boom' : null)
const OTHER_TENANT = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  logActivity.mockReset()
  captureRequestError.mockReset()
  memberIdForClerkUser.mockReset()
  memberIdForClerkUser.mockResolvedValue('target-member-1')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  seed()
})

describe('POST /api/admin/event-managers', () => {
  it('logs event_manager_assigned against the resolved member (AUTH-6)', async () => {
    const res = await assign()
    expect(res.status).toBe(201)
    expect(logActivity.mock.calls[0][0]).toMatchObject({
      memberId: 'target-member-1',
      action: 'event_manager_assigned',
      metadata: { event_slug: 'co-sdc', clerk_user_id: 'user_em' },
    })
    expect(logActivity.mock.calls[0][0].metadata).not.toHaveProperty('membership_sync')
  })

  it('writes one Stellr event_manager membership across several assignments (C9)', async () => {
    await assign('co-sdc')
    await assign('nv-sdc')
    await assign('co-sdc')
    expect(h.db.table('tenant_memberships')).toMatchObject([
      { tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_em', member_id: null, role: 'event_manager' },
    ])
    expect(h.db.table('tenant_memberships')).toHaveLength(1)
    expect(captureRequestError).not.toHaveBeenCalled()
  })

  it('a failed membership write leaves the action as it was, and is visible (C9)', async () => {
    seed(failMemberships)
    const res = await assign()
    expect(res.status).toBe(201)
    expect(h.db.table('event_manager_assignments')).toHaveLength(1)
    expect(await res.json()).toHaveProperty('assignment')
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('role_sync_failed event_manager_assign'))
    const [err, request, context] = captureRequestError.mock.calls[0]
    expect((err as Error).message).toContain('role_sync_failed event_manager_assign')
    expect((err as Error).message).not.toContain('user_em')
    expect(request).toEqual({ method: 'POST' })
    expect(context).toEqual({ routePath: '/api/admin/event-managers' })
    expect(logActivity.mock.calls[0][0].metadata).toMatchObject({ membership_sync: 'failed' })
  })

  it('a failed assignment writes no membership (C9)', async () => {
    seed((table) => (table === 'event_manager_assignments' ? 'boom' : null))
    const res = await assign()
    expect(res.status).toBe(500)
    expect(h.db.table('tenant_memberships')).toHaveLength(0)
    expect(logActivity).not.toHaveBeenCalled()
  })

  it("writes no membership for another tenant's event, and makes the refusal visible (C9)", async () => {
    h.db = fakeSupabase({ events: [{ slug: 'canary', tenant_id: OTHER_TENANT }] })
    const res = await assign('canary')
    expect(res.status).toBe(201)
    expect(h.db.table('tenant_memberships')).toHaveLength(0)
    expect((captureRequestError.mock.calls[0][0] as Error).message).toContain('step=cross_tenant')
    expect(logActivity.mock.calls[0][0].metadata).toMatchObject({ membership_sync: 'failed' })
  })
})

describe('DELETE /api/admin/event-managers', () => {
  it('logs event_manager_unassigned (AUTH-6)', async () => {
    const res = await unassign()
    expect(res.status).toBe(200)
    expect(logActivity.mock.calls[0][0]).toMatchObject({
      action: 'event_manager_unassigned',
      metadata: { event_slug: 'co-sdc', clerk_user_id: 'user_em' },
    })
  })

  it('keeps the membership until the last assignment goes (C9)', async () => {
    await assign('co-sdc')
    await assign('nv-sdc')
    await unassign('co-sdc')
    expect(h.db.table('tenant_memberships')).toHaveLength(1)
    await unassign('nv-sdc')
    expect(h.db.table('event_manager_assignments')).toHaveLength(0)
    expect(h.db.table('tenant_memberships')).toHaveLength(0)
  })

  it('a failed membership delete leaves the removal as it was, and is visible (C9)', async () => {
    h.db = fakeSupabase(
      { event_manager_assignments: [{ clerk_user_id: 'user_em', event_slug: 'co-sdc' }] },
      { failOn: (table, action) => (table === 'tenant_memberships' && action === 'delete' ? 'boom' : null) },
    )
    const res = await unassign()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(h.db.table('event_manager_assignments')).toHaveLength(0)
    expect(captureRequestError).toHaveBeenCalledOnce()
    expect(logActivity.mock.calls[0][0].metadata).toMatchObject({ membership_sync: 'failed' })
  })

  it('a failed assignment delete keeps the membership (C9)', async () => {
    const membership = { tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_em', member_id: null, role: 'event_manager' }
    h.db = fakeSupabase(
      { event_manager_assignments: [{ clerk_user_id: 'user_em', event_slug: 'co-sdc' }], tenant_memberships: [membership] },
      { failOn: (table, action) => (table === 'event_manager_assignments' && action === 'delete' ? 'boom' : null) },
    )
    const res = await unassign()
    expect(res.status).toBe(500)
    expect(h.db.table('tenant_memberships')).toHaveLength(1)
    expect(captureRequestError).not.toHaveBeenCalled()
  })

  it("takes the tenant from the deleted row, so another tenant's assignment never removes a Stellr membership (C9)", async () => {
    const membership = { tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_em', member_id: null, role: 'event_manager' }
    h.db = fakeSupabase({
      event_manager_assignments: [{ clerk_user_id: 'user_em', event_slug: 'canary', tenant_id: OTHER_TENANT }],
      tenant_memberships: [membership],
    })
    const res = await unassign('canary')
    expect(res.status).toBe(200)
    expect(h.db.table('tenant_memberships')).toHaveLength(1)
    expect((captureRequestError.mock.calls[0][0] as Error).message).toContain('step=cross_tenant')
  })
})
