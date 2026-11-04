// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// deep review QUAL-1: the impersonation audit row is a safeguarding control (an
// adult viewing a minor's portal). It must be AWAITED so a frozen instance
// cannot drop it after the response is sent.
//
// deep review AUTH-9: the POST refuses a target who is another platform admin,
// and the DELETE logs impersonation_ended so an access review sees both ends of
// the window.
//
// S0 (Nov 2026): every check fails closed. Any staff target is refused (admin
// or event manager, by Clerk role or a staff_roles row), a Clerk or database
// error refuses, the ticket must name the admin who started it, view-as is off
// without its own signing secret, and the start and end only happen if their
// audit rows are written.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  isAdmin: true,
  configured: true,
  cookieValue: undefined as string | undefined,
  decoded: null as { memberId: string; adminMemberId: string; issuedAt: number } | null,
  encoded: [] as unknown[],
  actor: { actorType: 'admin', actorMemberId: 'admin1' } as Record<string, unknown>,
  auditOn: false,
}))
const logActivityOrThrow = vi.fn()
const platformAudit = vi.fn()
const getUser = vi.fn()

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: 'admin-clerk', sessionClaims: { metadata: { role: h.isAdmin ? 'admin' : undefined } } }),
  clerkClient: async () => ({ users: { getUser } }),
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (h.cookieValue ? { value: h.cookieValue } : undefined) }),
}))
vi.mock('@/lib/impersonation', () => ({
  encodeTicket: (t: unknown) => {
    h.encoded.push(t)
    return 'ticket-abc'
  },
  decodeTicket: () => h.decoded,
  impersonationConfigured: () => h.configured,
  ImpersonationNotConfiguredError: class extends Error {
    constructor() {
      super('View as member is switched off on this deployment: IMPERSONATION_SECRET is not set.')
    }
  },
  IMPERSONATION_COOKIE: 'imp',
  IMPERSONATION_TTL_SECONDS: 1800,
}))
vi.mock('@/lib/activity-log', () => ({
  logActivityOrThrow: (...a: unknown[]) => logActivityOrThrow(...a),
  actorFromAuth: async () => h.actor,
}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => h.db.client }))
vi.mock('@/lib/audit/platform', () => ({
  auditEnabled: () => h.auditOn,
  audit: (...a: unknown[]) => platformAudit(...a),
}))

const { POST, DELETE } = await import('./route')

const M1 = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const NOBODY = '99999999-9999-4999-8999-999999999999'
const TARGET = { id: M1, first_name: 'A', last_name: 'B', email: 'a@b.c', clerk_user_id: 'clerk_target' }
const OTHER_MEMBER = { id: OTHER, first_name: 'C', last_name: 'D', email: 'c@d.e', clerk_user_id: null }
const ADMIN_ROW = { id: 'admin1', clerk_user_id: 'admin-clerk' }

beforeEach(() => {
  logActivityOrThrow.mockReset()
  logActivityOrThrow.mockResolvedValue(undefined)
  getUser.mockReset()
  getUser.mockResolvedValue({ publicMetadata: {} })
  h.db = fakeSupabase({ members: [TARGET, OTHER_MEMBER, ADMIN_ROW], staff_roles: [] })
  h.isAdmin = true
  h.configured = true
  h.cookieValue = undefined
  h.decoded = null
  h.encoded = []
  h.actor = { actorType: 'admin', actorMemberId: 'admin1' }
  h.auditOn = false
  platformAudit.mockReset()
  platformAudit.mockResolvedValue({ ok: true, id: 1, seq: 1 })
})

function post(memberId = M1) {
  return POST(new Request('https://app.test/api/admin/impersonation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ memberId }),
  }))
}

/** The view-as cookie this response sets, or null. */
function cookieSet(res: Response): string | null {
  const header = res.headers.get('set-cookie') ?? ''
  const m = /(?:^|,\s*)imp=([^;]*)/.exec(header)
  return m ? m[1] : null
}

const actions = () => logActivityOrThrow.mock.calls.map((c) => (c[0] as { action: string }).action)

/** A view-as cookie for `memberId`, started by this admin. */
function holdTicketFor(memberId: string) {
  h.cookieValue = 'old-ticket'
  h.decoded = { memberId, adminMemberId: 'admin1', issuedAt: Date.now() }
}

describe('POST /api/admin/impersonation', () => {
  it('starts view-as of a member: ticket bound to this admin, start audited, cookie set', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(h.encoded).toEqual([expect.objectContaining({ memberId: M1, adminMemberId: 'admin1' })])
    expect(actions()).toEqual(['impersonation_started'])
    expect(logActivityOrThrow.mock.calls[0][0]).toMatchObject({ memberId: M1, category: 'account' })
    expect(cookieSet(res)).toBe('ticket-abc')
  })

  it('awaits the audit log before returning (a frozen instance cannot drop it)', async () => {
    let settled = false
    logActivityOrThrow.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5))
      settled = true
    })
    const res = await post()
    expect(res.status).toBe(200)
    expect(settled, 'the audit insert had not settled when the response returned').toBe(true)
  })

  // The best-effort actor lookup falls back to an anonymous 'system' actor on
  // any error. The start row must still say which admin started the session.
  it('records the verified admin as the starter, even when the actor lookup comes back empty', async () => {
    h.actor = { actorType: 'system' }
    const res = await post()
    expect(res.status).toBe(200)
    expect(logActivityOrThrow.mock.calls[0][0]).toMatchObject({
      action: 'impersonation_started',
      actorType: 'admin',
      actorMemberId: 'admin1',
      metadata: { adminMemberId: 'admin1' },
    })
  })

  it('403s a non-admin', async () => {
    h.isAdmin = false
    const res = await post()
    expect(res.status).toBe(403)
    expect(cookieSet(res)).toBeNull()
  })

  it.each(['admin', 'event_manager'])('refuses a target whose Clerk role is %s', async (role) => {
    getUser.mockResolvedValue({ publicMetadata: { role } })
    const res = await post()
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Cannot view as a staff member.' })
    expect(logActivityOrThrow).not.toHaveBeenCalled()
    expect(cookieSet(res)).toBeNull()
  })

  it('refuses a target with a staff_roles row, without asking Clerk', async () => {
    h.db = fakeSupabase({ members: [TARGET, ADMIN_ROW], staff_roles: [{ member_id: M1, scopes: ['events'] }] })
    const res = await post()
    expect(res.status).toBe(403)
    expect(getUser).not.toHaveBeenCalled()
    expect(cookieSet(res)).toBeNull()
  })

  it('fails closed when Clerk cannot say whether the target is staff', async () => {
    getUser.mockRejectedValue(new Error('Clerk is down'))
    const res = await post()
    expect(res.status).toBe(503)
    expect(logActivityOrThrow).not.toHaveBeenCalled()
    expect(cookieSet(res)).toBeNull()
  })

  // A member row can point at a Clerk user that no longer exists (a missed
  // user.deleted webhook). That is an answer, not an outage: no Clerk user, no
  // role. Retrying a 503 could never succeed.
  it('treats a Clerk 404 as "no Clerk user, so not staff"', async () => {
    getUser.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }))
    const res = await post()
    expect(res.status).toBe(200)
    expect(actions()).toEqual(['impersonation_started'])
    expect(cookieSet(res)).toBe('ticket-abc')
  })

  it('still fails closed on any other Clerk error status', async () => {
    getUser.mockRejectedValue(Object.assign(new Error('Too many requests'), { status: 429 }))
    const res = await post()
    expect(res.status).toBe(503)
    expect(cookieSet(res)).toBeNull()
  })

  it('fails closed when the staff_roles lookup errors', async () => {
    h.db = fakeSupabase({ members: [TARGET, ADMIN_ROW], staff_roles: [] }, {
      failOn: (table) => (table === 'staff_roles' ? 'boom' : null),
    })
    const res = await post()
    expect(res.status).toBe(503)
    expect(cookieSet(res)).toBeNull()
  })

  it('needs no Clerk check for a member with no Clerk account', async () => {
    h.db = fakeSupabase({ members: [{ ...TARGET, clerk_user_id: null }, ADMIN_ROW], staff_roles: [] })
    const res = await post()
    expect(res.status).toBe(200)
    expect(getUser).not.toHaveBeenCalled()
  })

  it('refuses an admin with no member row: the ticket could not be bound to them', async () => {
    h.db = fakeSupabase({ members: [TARGET], staff_roles: [] })
    const res = await post()
    expect(res.status).toBe(403)
    expect(h.encoded).toEqual([])
    expect(logActivityOrThrow).not.toHaveBeenCalled()
    expect(cookieSet(res)).toBeNull()
  })

  it('404s an unknown member', async () => {
    expect((await post(NOBODY)).status).toBe(404)
  })

  it('400s a malformed member id rather than reporting a database error', async () => {
    const res = await post('not-a-uuid')
    expect(res.status).toBe(400)
    expect(getUser).not.toHaveBeenCalled()
    expect(cookieSet(res)).toBeNull()
  })

  it('without IMPERSONATION_SECRET: says view-as is off, before touching anything', async () => {
    h.configured = false
    const res = await post()
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/IMPERSONATION_SECRET/)
    expect(getUser).not.toHaveBeenCalled()
    expect(cookieSet(res)).toBeNull()
  })

  it('does not start when the audit row cannot be written', async () => {
    logActivityOrThrow.mockRejectedValue(new Error('insert failed'))
    const res = await post()
    expect(res.status).toBe(503)
    expect(cookieSet(res)).toBeNull()
  })

  it('switching members closes the previous session in the audit trail first', async () => {
    holdTicketFor(OTHER)
    const res = await post()
    expect(res.status).toBe(200)
    expect(actions()).toEqual(['impersonation_ended', 'impersonation_started'])
    expect(logActivityOrThrow.mock.calls[0][0]).toMatchObject({
      memberId: OTHER,
      actorType: 'admin',
      actorMemberId: 'admin1',
      metadata: { reason: 'replaced', adminMemberId: 'admin1' },
    })
  })

  it('switching members: when the new start cannot be recorded after the old end was, the old session ends too', async () => {
    holdTicketFor(OTHER)
    logActivityOrThrow.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('insert failed'))
    const res = await post()
    expect(res.status).toBe(503)
    expect(actions()).toEqual(['impersonation_ended', 'impersonation_started'])
    expect((await res.json()).error).toMatch(/previous view-as session has ended/)
    // The audit trail says the old session ended, so its cookie is cleared, not kept.
    expect(cookieSet(res)).toBe('')
  })

  it('switching members: when the old end cannot be recorded, the old session is left as it was', async () => {
    holdTicketFor(OTHER)
    logActivityOrThrow.mockRejectedValueOnce(new Error('insert failed'))
    const res = await post()
    expect(res.status).toBe(503)
    expect(actions()).toEqual(['impersonation_ended'])
    // Says what actually failed: the end of the old session, not the new start.
    expect((await res.json()).error).toMatch(/end of your current view-as session/)
    expect(cookieSet(res)).toBeNull()
  })

  // The member of the old session was purged while it ran. Their log rows
  // cascaded away with them, so the end can never be recorded; that must not
  // block starting a new session for up to 30 minutes.
  it('switching members: an old session whose member was purged does not block the new one', async () => {
    holdTicketFor(NOBODY)
    logActivityOrThrow.mockRejectedValueOnce(new Error('violates foreign key constraint'))
    const res = await post()
    expect(res.status).toBe(200)
    expect(actions()).toEqual(['impersonation_ended', 'impersonation_started'])
    expect(cookieSet(res)).toBe('ticket-abc')
  })
})

describe('DELETE /api/admin/impersonation', () => {
  it('logs impersonation_ended, then clears the cookie (AUTH-9)', async () => {
    h.cookieValue = 'ticket-abc'
    h.decoded = { memberId: M1, adminMemberId: 'admin1', issuedAt: Date.now() }
    const res = await DELETE()
    expect(res.status).toBe(200)
    expect(actions()).toEqual(['impersonation_ended'])
    expect(logActivityOrThrow.mock.calls[0][0]).toMatchObject({ memberId: M1, metadata: { reason: 'exited' } })
    expect(cookieSet(res)).toBe('')
  })

  // DELETE is not admin-gated, so whoever ends the session is recorded as found;
  // the admin who started it comes from the signed ticket.
  it('names the admin who started the session, whoever ends it', async () => {
    h.cookieValue = 'ticket-abc'
    h.decoded = { memberId: M1, adminMemberId: 'admin-who-started', issuedAt: Date.now() }
    h.actor = { actorType: 'system' }
    const res = await DELETE()
    expect(res.status).toBe(200)
    expect(logActivityOrThrow.mock.calls[0][0]).toMatchObject({
      actorType: 'system',
      metadata: { reason: 'exited', adminMemberId: 'admin-who-started' },
    })
  })

  it('leaves the session running when its end cannot be recorded', async () => {
    h.cookieValue = 'ticket-abc'
    h.decoded = { memberId: M1, adminMemberId: 'admin1', issuedAt: Date.now() }
    logActivityOrThrow.mockRejectedValue(new Error('insert failed'))
    const res = await DELETE()
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/still running/)
    expect(cookieSet(res)).toBeNull()
  })

  it('ends the session when its member was purged: there is nothing left to record against', async () => {
    h.cookieValue = 'ticket-abc'
    h.decoded = { memberId: NOBODY, adminMemberId: 'admin1', issuedAt: Date.now() }
    logActivityOrThrow.mockRejectedValue(new Error('violates foreign key constraint'))
    const res = await DELETE()
    expect(res.status).toBe(200)
    expect(cookieSet(res)).toBe('')
  })

  it('stays fail-closed when it cannot tell whether the member was purged', async () => {
    h.cookieValue = 'ticket-abc'
    h.decoded = { memberId: NOBODY, adminMemberId: 'admin1', issuedAt: Date.now() }
    h.db = fakeSupabase({ members: [] }, { failOn: (table) => (table === 'members' ? 'boom' : null) })
    logActivityOrThrow.mockRejectedValue(new Error('insert failed'))
    const res = await DELETE()
    expect(res.status).toBe(503)
    expect(cookieSet(res)).toBeNull()
  })

  it('just clears the cookie when there is no live ticket', async () => {
    h.cookieValue = 'expired-or-forged'
    h.decoded = null
    const res = await DELETE()
    expect(res.status).toBe(200)
    expect(logActivityOrThrow).not.toHaveBeenCalled()
    expect(cookieSet(res)).toBe('')
  })
})

// S4: the platform audit log is a shadow copy behind PLATFORM_AUDIT_ENABLED.
// Off, nothing calls it. On, it records each edge after the member_activity_log
// row, and its result never changes the response.
describe('platform audit (PLATFORM_AUDIT_ENABLED)', () => {
  const STELLR = '00000000-0000-4000-8000-000000000001'

  it('is not called while the flag is off', async () => {
    holdTicketFor(OTHER)
    expect((await post()).status).toBe(200)
    expect((await DELETE()).status).toBe(200)
    expect(platformAudit).not.toHaveBeenCalled()
  })

  it('records the start on Stellr\'s chain, ids only, after the activity row', async () => {
    h.auditOn = true
    const res = await post()
    expect(res.status).toBe(200)
    expect(platformAudit).toHaveBeenCalledTimes(1)
    expect(platformAudit.mock.calls[0][0]).toEqual({
      tenantId: STELLR,
      actor: 'admin-clerk',
      action: 'support.impersonate.start',
      target: { table: 'members', id: M1 },
      metadata: { adminMemberId: 'admin1' },
    })
    expect(logActivityOrThrow.mock.invocationCallOrder[0]).toBeLessThan(platformAudit.mock.invocationCallOrder[0])
  })

  it('records the replaced session\'s end before the new start when switching', async () => {
    h.auditOn = true
    holdTicketFor(OTHER)
    expect((await post()).status).toBe(200)
    expect(platformAudit.mock.calls.map((c) => (c[0] as { action: string }).action)).toEqual([
      'support.impersonate.stop',
      'support.impersonate.start',
    ])
    expect(platformAudit.mock.calls[0][0]).toMatchObject({ target: { id: OTHER }, metadata: { reason: 'replaced' } })
  })

  it('records the end on DELETE', async () => {
    h.auditOn = true
    h.cookieValue = 'ticket-abc'
    h.decoded = { memberId: M1, adminMemberId: 'admin1', issuedAt: Date.now() }
    const res = await DELETE()
    expect(res.status).toBe(200)
    expect(platformAudit.mock.calls[0][0]).toMatchObject({
      actor: 'admin-clerk',
      action: 'support.impersonate.stop',
      metadata: { adminMemberId: 'admin1', reason: 'exited' },
    })
  })

  it('a failed platform audit write changes nothing for the caller', async () => {
    h.auditOn = true
    platformAudit.mockResolvedValue({ ok: false, error: 'db down' })
    const res = await post()
    expect(res.status).toBe(200)
    expect(cookieSet(res)).toBe('ticket-abc')
  })

  it('is not called when the session did not start', async () => {
    h.auditOn = true
    logActivityOrThrow.mockRejectedValue(new Error('insert failed'))
    expect((await post()).status).toBe(503)
    expect(platformAudit).not.toHaveBeenCalled()
  })
})
