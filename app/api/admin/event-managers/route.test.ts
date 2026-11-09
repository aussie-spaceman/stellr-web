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

const clerkRole = { value: undefined as string | undefined }
const updateUserMetadata = vi.fn(async (_id: string, p: { publicMetadata: { role?: string | null } }) => {
  clerkRole.value = p.publicMetadata.role ?? undefined
})
const sendEmail = vi.fn(async () => ({ id: 'email_1' }))
vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: 'user_admin', sessionClaims: { metadata: { role: 'admin' } } }),
  clerkClient: async () => ({
    users: {
      getUserList: async () => ({ data: [] }),
      getUser: async () => ({ publicMetadata: clerkRole.value ? { role: clerkRole.value } : {} }),
      updateUserMetadata,
    },
  }),
}))
vi.mock('@/lib/events/repo', () => ({
  getEventBySlug: async (slug: string) => ({ title: `Event ${slug}`, date: '2026-12-05', endDate: '2026-12-06' }),
}))
vi.mock('@/lib/email', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...(a as [])) }))
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

// A cleared adult with a login: the gate (lib/event-manager) lets them through.
// fake-supabase ignores the select list, so the clearance rows ride on the member.
const CLEARED_MEMBER = {
  id: 'target-member-1',
  clerk_user_id: 'user_em',
  first_name: 'Em',
  email: 'em@example.test',
  is_active: true,
  date_of_birth: '1980-04-01',
  member_teacher_licenses: [],
  member_external_background_checks: [],
  member_background_checks: [
    { id: 'bc1', status: 'passed', ordered_at: '2026-01-10T00:00:00Z', completed_at: '2026-01-20T00:00:00Z', expires_at: '2029-01-20T00:00:00Z', adjudication_outcome: null, adjudicated_at: null },
  ],
}

const withMember = (tables: Record<string, unknown[]> = {}) => ({ members: [CLEARED_MEMBER], ...tables })

function seed(failOn?: (table: string, action: string) => string | null) {
  h.db = fakeSupabase(withMember(), { failOn })
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
  // Expiry rules compare with today: pin it so the fixed dates below never rot.
  vi.useFakeTimers({ now: new Date('2026-11-09T12:00:00Z'), toFake: ['Date'] })
  clerkRole.value = undefined
  updateUserMetadata.mockClear()
  sendEmail.mockClear()
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
    h.db = fakeSupabase(withMember({ events: [{ slug: "canary", tenant_id: OTHER_TENANT }] }))
    const res = await assign('canary')
    expect(res.status).toBe(201)
    expect(h.db.table('tenant_memberships')).toHaveLength(0)
    expect((captureRequestError.mock.calls[0][0] as Error).message).toContain('step=cross_tenant')
    expect(logActivity.mock.calls[0][0].metadata).toMatchObject({ membership_sync: 'failed' })
  })
})

// 9 Nov 2026: the safeguarding gate, expiry, Clerk role and email, which this
// route now shares with the member page through lib/event-manager.
describe('POST /api/admin/event-managers — who may hold it', () => {
  const memberWith = (over: Record<string, unknown>) => fakeSupabase({ members: [{ ...CLEARED_MEMBER, ...over }] })

  it('refuses a member with no clearance on file', async () => {
    h.db = memberWith({ member_background_checks: [] })
    const res = await assign()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('not_cleared')
    expect(h.db.table('event_manager_assignments')).toHaveLength(0)
    expect(updateUserMetadata).not.toHaveBeenCalled()
  })

  it('refuses a minor, even with a passed check', async () => {
    h.db = memberWith({ date_of_birth: '2012-05-01' })
    const res = await assign()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('minor')
  })

  it('refuses an unknown date of birth', async () => {
    h.db = memberWith({ date_of_birth: null })
    expect((await (await assign()).json()).code).toBe('no_dob')
  })

  it('refuses a deactivated member', async () => {
    h.db = memberWith({ is_active: false })
    expect((await (await assign()).json()).code).toBe('inactive')
  })

  it('refuses when the check was adjudicated not cleared', async () => {
    h.db = memberWith({
      member_background_checks: [{ ...CLEARED_MEMBER.member_background_checks[0], status: 'referred', adjudication_outcome: 'not_cleared', adjudicated_at: '2026-02-01T00:00:00Z' }],
      member_teacher_licenses: [{ id: 'l1', license_number: 'X', licensing_state: 'MN', expiry_date: '2030-01-01', verified_at: '2026-01-01T00:00:00Z', verified_label: 'Admin', document_path: null }],
    })
    expect((await (await assign()).json()).code).toBe('not_cleared')
  })

  it('accepts a verified uploaded check from another organisation', async () => {
    h.db = memberWith({
      member_background_checks: [],
      member_external_background_checks: [{ id: 'x1', issuer: 'ISD 196', completed_on: '2025-08-01', document_expires_on: null, document_path: 'm/bc/1.pdf', verified_at: '2026-01-01T00:00:00Z', verified_label: 'Admin' }],
    })
    const res = await assign()
    expect(res.status).toBe(201)
    expect(h.db.table('event_manager_assignments')[0]).toMatchObject({ clearance_basis: 'external_background_check' })
  })

  it('refuses an uploaded check still waiting verification', async () => {
    h.db = memberWith({
      member_background_checks: [],
      member_external_background_checks: [{ id: 'x1', issuer: 'ISD 196', completed_on: '2025-08-01', document_expires_on: null, document_path: 'm/bc/1.pdf', verified_at: null, verified_label: null }],
    })
    expect((await (await assign()).json()).code).toBe('awaiting_verification')
  })
})

describe('POST /api/admin/event-managers — expiry, Clerk role, email', () => {
  it('defaults the expiry to the event end + 30 days, and records the clearance', async () => {
    const res = await assign()
    expect(await res.json()).toMatchObject({ assignment: { expires_on: '2027-01-05' } })
    expect(h.db.table('event_manager_assignments')[0]).toMatchObject({
      member_id: 'target-member-1',
      expires_at: '2027-01-05T23:59:59.999Z',
      clearance_basis: 'background_check',
    })
  })

  it('refuses an expiry past the clearance', async () => {
    h.db = fakeSupabase({
      members: [{ ...CLEARED_MEMBER, member_background_checks: [{ ...CLEARED_MEMBER.member_background_checks[0], expires_at: '2027-03-01T00:00:00Z' }] }],
    })
    const res = await POST(new Request('https://app.test/api/admin/event-managers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clerk_user_id: 'user_em', event_slug: 'co-sdc', expires_on: '2027-06-01' }),
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('bad_expiry')
  })

  it('sets the Clerk role on the first assignment and clears it with the last', async () => {
    await assign('co-sdc')
    expect(updateUserMetadata).toHaveBeenCalledWith('user_em', { publicMetadata: { role: 'event_manager' } })
    await assign('nv-sdc')
    expect(updateUserMetadata).toHaveBeenCalledTimes(1)
    await unassign('co-sdc')
    expect(clerkRole.value).toBe('event_manager')
    await unassign('nv-sdc')
    expect(updateUserMetadata).toHaveBeenLastCalledWith('user_em', { publicMetadata: { role: null } })
    expect(clerkRole.value).toBeUndefined()
  })

  it("never touches an admin's Clerk role", async () => {
    clerkRole.value = 'admin'
    await assign()
    await unassign()
    expect(updateUserMetadata).not.toHaveBeenCalled()
    expect(clerkRole.value).toBe('admin')
  })

  it('emails the person on a new grant and on removal, not on a re-confirm', async () => {
    await assign()
    await assign()
    expect(sendEmail).toHaveBeenCalledTimes(1)
    await unassign()
    expect(sendEmail).toHaveBeenCalledTimes(2)
  })
})

describe('DELETE /api/admin/event-managers', () => {
  it('logs event_manager_unassigned (AUTH-6)', async () => {
    await assign()
    logActivity.mockClear()
    const res = await unassign()
    expect(res.status).toBe(200)
    expect(logActivity.mock.calls[0][0]).toMatchObject({
      memberId: 'target-member-1',
      action: 'event_manager_unassigned',
      metadata: { event_slug: 'co-sdc', clerk_user_id: 'user_em', reason: 'admin' },
    })
  })

  it('removing nothing is a no-op: no log, no email', async () => {
    const res = await unassign()
    expect(res.status).toBe(200)
    expect(logActivity).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
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
