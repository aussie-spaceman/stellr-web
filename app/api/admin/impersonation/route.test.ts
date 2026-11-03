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
}))
const logActivityOrThrow = vi.fn()
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
  actorFromAuth: async () => ({ actorType: 'admin', actorMemberId: 'admin1' }),
}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => h.db.client }))

const { POST, DELETE } = await import('./route')

const TARGET = { id: 'm1', first_name: 'A', last_name: 'B', email: 'a@b.c', clerk_user_id: 'clerk_target' }
const ADMIN_ROW = { id: 'admin1', clerk_user_id: 'admin-clerk' }

beforeEach(() => {
  logActivityOrThrow.mockReset()
  logActivityOrThrow.mockResolvedValue(undefined)
  getUser.mockReset()
  getUser.mockResolvedValue({ publicMetadata: {} })
  h.db = fakeSupabase({ members: [TARGET, ADMIN_ROW], staff_roles: [] })
  h.isAdmin = true
  h.configured = true
  h.cookieValue = undefined
  h.decoded = null
  h.encoded = []
})

function post(memberId = 'm1') {
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

describe('POST /api/admin/impersonation', () => {
  it('starts view-as of a member: ticket bound to this admin, start audited, cookie set', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(h.encoded).toEqual([expect.objectContaining({ memberId: 'm1', adminMemberId: 'admin1' })])
    expect(actions()).toEqual(['impersonation_started'])
    expect(logActivityOrThrow.mock.calls[0][0]).toMatchObject({ memberId: 'm1', category: 'account' })
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
    h.db = fakeSupabase({ members: [TARGET, ADMIN_ROW], staff_roles: [{ member_id: 'm1', scopes: ['events'] }] })
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
    expect((await post('nobody')).status).toBe(404)
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
    h.cookieValue = 'old-ticket'
    h.decoded = { memberId: 'someone-else', adminMemberId: 'admin1', issuedAt: Date.now() }
    const res = await post()
    expect(res.status).toBe(200)
    expect(actions()).toEqual(['impersonation_ended', 'impersonation_started'])
    expect(logActivityOrThrow.mock.calls[0][0]).toMatchObject({ memberId: 'someone-else', metadata: { reason: 'replaced' } })
  })

  it('switching members: when the new start cannot be recorded after the old end was, the old session ends too', async () => {
    h.cookieValue = 'old-ticket'
    h.decoded = { memberId: 'someone-else', adminMemberId: 'admin1', issuedAt: Date.now() }
    logActivityOrThrow.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('insert failed'))
    const res = await post()
    expect(res.status).toBe(503)
    expect(actions()).toEqual(['impersonation_ended', 'impersonation_started'])
    expect((await res.json()).error).toMatch(/previous view-as session has ended/)
    // The audit trail says the old session ended, so its cookie is cleared, not kept.
    expect(cookieSet(res)).toBe('')
  })

  it('switching members: when the old end cannot be recorded, the old session is left as it was', async () => {
    h.cookieValue = 'old-ticket'
    h.decoded = { memberId: 'someone-else', adminMemberId: 'admin1', issuedAt: Date.now() }
    logActivityOrThrow.mockRejectedValueOnce(new Error('insert failed'))
    const res = await post()
    expect(res.status).toBe(503)
    expect(actions()).toEqual(['impersonation_ended'])
    expect(cookieSet(res)).toBeNull()
  })
})

describe('DELETE /api/admin/impersonation', () => {
  it('logs impersonation_ended, then clears the cookie (AUTH-9)', async () => {
    h.cookieValue = 'ticket-abc'
    h.decoded = { memberId: 'm1', adminMemberId: 'admin1', issuedAt: Date.now() }
    const res = await DELETE()
    expect(res.status).toBe(200)
    expect(actions()).toEqual(['impersonation_ended'])
    expect(logActivityOrThrow.mock.calls[0][0]).toMatchObject({ memberId: 'm1', metadata: { reason: 'exited' } })
    expect(cookieSet(res)).toBe('')
  })

  it('leaves the session running when its end cannot be recorded', async () => {
    h.cookieValue = 'ticket-abc'
    h.decoded = { memberId: 'm1', adminMemberId: 'admin1', issuedAt: Date.now() }
    logActivityOrThrow.mockRejectedValue(new Error('insert failed'))
    const res = await DELETE()
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/still running/)
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
