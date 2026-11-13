// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// deep review AUTH-6: granting or revoking staff function scopes must be audited
// (who set them, to what), like the rest of the admin surface.
//
// S5 C9: each path also keeps the Stellr staff membership in step. A failure there
// must not fail the action, and must be visible.

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }))
const logActivity = vi.fn()
const captureRequestError = vi.fn()

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ sessionClaims: { metadata: { role: 'admin' } } }),
}))
vi.mock('@/lib/community', () => ({ getSignedInMember: async () => ({ id: 'admin1' }) }))
vi.mock('@/lib/activity-log', () => ({
  logActivity: (...a: unknown[]) => logActivity(...a),
  actorFromAuth: async () => ({ actorType: 'admin', actorMemberId: 'admin1' }),
}))
vi.mock('@/lib/app-errors', () => ({
  captureRequestError: (...a: unknown[]) => captureRequestError(...a),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => h.db.client,
}))

const { POST, DELETE } = await import('./route')

const MEMBER = { id: 'm1', first_name: 'A', last_name: 'B', email: 'a@b.c', clerk_user_id: 'user_s' }

function seed(failOn?: (table: string, action: string) => string | null, tables: Record<string, object[]> = {}) {
  h.db = fakeSupabase({ members: [MEMBER], ...tables }, { failOn })
}

const grant = (scopes = ['events', 'community']) =>
  POST(new Request('https://app.test/api/admin/duties', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ memberId: 'm1', scopes }),
  }))
const revoke = () =>
  DELETE(new Request('https://app.test/api/admin/duties', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ memberId: 'm1' }),
  }))

beforeEach(() => {
  logActivity.mockReset()
  captureRequestError.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  seed()
})

describe('POST /api/admin/duties', () => {
  it('logs duty_scopes_set after a successful grant (AUTH-6)', async () => {
    const res = await grant()
    expect(res.status).toBe(200)
    expect(logActivity).toHaveBeenCalledOnce()
    expect(logActivity.mock.calls[0][0]).toMatchObject({
      memberId: 'm1',
      action: 'duty_scopes_set',
      metadata: { scopes: ['events', 'community'] },
    })
    expect(logActivity.mock.calls[0][0].metadata).not.toHaveProperty('membership_sync')
  })

  it('does not log when the upsert fails', async () => {
    seed((table) => (table === 'admin_duties' ? 'boom' : null))
    const res = await grant(['events'])
    expect(res.status).toBe(500)
    expect(logActivity).not.toHaveBeenCalled()
    expect(h.db.table('tenant_memberships')).toHaveLength(0)
  })

  it('the staff membership write is idempotent, however often scopes change (C9)', async () => {
    await grant(['events'])
    await grant(['events', 'community'])
    expect(h.db.table('tenant_memberships')).toMatchObject([
      { tenant_id: STELLR_TENANT_ID, member_id: 'm1', clerk_user_id: 'user_s', role: 'duty_holder' },
    ])
    expect(h.db.table('tenant_memberships')).toHaveLength(1)
    expect(captureRequestError).not.toHaveBeenCalled()
  })

  it('a failed membership write leaves the grant as it was, and is visible (C9)', async () => {
    seed((table) => (table === 'tenant_memberships' ? 'boom' : null))
    const res = await grant(['events'])
    expect(res.status).toBe(200)
    expect(h.db.table('admin_duties')).toHaveLength(1)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('role_sync_failed duty_grant'))
    expect((captureRequestError.mock.calls[0][0] as Error).message).toContain('role_sync_failed duty_grant')
    expect(logActivity.mock.calls[0][0].metadata).toMatchObject({ scopes: ['events'], membership_sync: 'failed' })
  })

  it('the response carries no new fields (C9)', async () => {
    h.db = fakeSupabase({ members: [{ id: 'm1', first_name: 'A', last_name: 'B', email: 'a@b.c', clerk_user_id: 'user_s' }] })
    const body = await (await grant(['events'])).json()
    expect(Object.keys(body).sort()).toEqual(['member', 'ok'])
  })
})

describe('DELETE /api/admin/duties', () => {
  it('logs duty_scopes_removed after a successful revoke (AUTH-6)', async () => {
    const res = await revoke()
    expect(res.status).toBe(200)
    expect(logActivity.mock.calls[0][0]).toMatchObject({ memberId: 'm1', action: 'duty_scopes_removed' })
    expect(logActivity.mock.calls[0][0]).not.toHaveProperty('metadata')
  })

  it('removes the staff membership and leaves other roles (C9)', async () => {
    seed(undefined, {
      admin_duties: [{ member_id: 'm1', scopes: ['events'] }],
      tenant_memberships: [
        { tenant_id: STELLR_TENANT_ID, member_id: 'm1', clerk_user_id: 'user_s', role: 'duty_holder' },
        { tenant_id: STELLR_TENANT_ID, member_id: null, clerk_user_id: 'user_s', role: 'event_manager' },
      ],
    })
    await revoke()
    expect(h.db.table('tenant_memberships')).toMatchObject([{ role: 'event_manager' }])
    expect(h.db.table('tenant_memberships')).toHaveLength(1)
  })

  it('a failed membership delete leaves the revoke as it was, and is visible (C9)', async () => {
    seed((table, action) => (table === 'tenant_memberships' && action === 'delete' ? 'boom' : null), {
      admin_duties: [{ member_id: 'm1', scopes: ['events'] }],
    })
    const res = await revoke()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(h.db.table('admin_duties')).toHaveLength(0)
    expect(captureRequestError).toHaveBeenCalledOnce()
    expect(logActivity.mock.calls[0][0].metadata).toEqual({ membership_sync: 'failed' })
  })

  it('a failed admin_duties delete keeps the membership (C9)', async () => {
    seed((table, action) => (table === 'admin_duties' && action === 'delete' ? 'boom' : null), {
      admin_duties: [{ member_id: 'm1', scopes: ['events'] }],
      tenant_memberships: [{ tenant_id: STELLR_TENANT_ID, member_id: 'm1', clerk_user_id: 'user_s', role: 'duty_holder' }],
    })
    const res = await revoke()
    expect(res.status).toBe(500)
    expect(h.db.table('tenant_memberships')).toHaveLength(1)
    expect(captureRequestError).not.toHaveBeenCalled()
  })
})
