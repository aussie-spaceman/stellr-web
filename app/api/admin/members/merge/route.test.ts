// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Owner decision 13 Nov 2026 (tracker attendee-email-cohort.4): event crew
// check-ins leave with the account. A merge deletes the dropped record's login
// (unless the kept record takes it over), through the same login removal as a
// member hard delete (lib/deletion/external.ts), so that login's event-manager
// check-ins (m.<Clerk id>) go with it. The dropped record's volunteer rows are
// repointed by merge_members like every other member_id reference.

const KEEP = '11111111-1111-4111-8111-111111111111'
const DROP = '22222222-2222-4222-8222-222222222222'
const KEEP_LOGIN = 'user_keep_placeholder'
const DROP_LOGIN = 'user_drop_placeholder'

type CrewRow = { id: string; crew_key: string; member_id: string | null }
let members: Record<string, unknown>[]
let staff: CrewRow[]
const deleteUser = vi.fn(async (..._a: unknown[]) => ({}))
const rpc = vi.fn()

// The kept login, as Clerk holds it. Each test sets its addresses.
type ClerkAddress = { id: string; emailAddress: string; verification: { status: string } }
let clerkUser: { id: string; primaryEmailAddressId: string | null; emailAddresses: ClerkAddress[] }
const getUser = vi.fn(async (_id: string) => clerkUser)
const updateUser = vi.fn(async (_id: string, _p: { primaryEmailAddressID?: string }) => clerkUser)
const createEmailAddress = vi.fn(async (p: { userId: string; emailAddress: string; verified?: boolean }) => {
  const a = { id: `idn_new_${clerkUser.emailAddresses.length}`, emailAddress: p.emailAddress, verification: { status: p.verified ? 'verified' : 'unverified' } }
  clerkUser.emailAddresses.push(a)
  return a
})
const updateEmailAddress = vi.fn(async (id: string, p: { verified?: boolean }) => {
  const a = clerkUser.emailAddresses.find((x) => x.id === id)!
  if (p.verified) a.verification = { status: 'verified' }
  return a
})
const deleteEmailAddress = vi.fn(async (id: string) => {
  clerkUser.emailAddresses = clerkUser.emailAddresses.filter((x) => x.id !== id)
  return { id, deleted: true }
})
const logActivity = vi.fn(async (..._a: unknown[]) => {})

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: 'user_admin_placeholder' }),
  clerkClient: async () => ({
    users: { deleteUser, getUser, updateUser },
    emailAddresses: { createEmailAddress, updateEmailAddress, deleteEmailAddress },
  }),
}))
vi.mock('@/lib/admin-auth', () => ({ currentUserIsAdmin: async () => true }))
vi.mock('@/lib/activity-log', () => ({
  actorFromAuth: async () => ({ actorMemberId: null, actorLabel: 'admin' }),
  logActivity,
}))
vi.mock('@/lib/audit/route', () => ({ withAudit: (_spec: unknown, handler: unknown) => handler }))
vi.mock('@/lib/authz/principal', () => ({ loadTargetClerkRole: async () => ({ exists: true, role: undefined }) }))
vi.mock('@/lib/authz', () => ({ isCrewTargetOrUnknown: async () => false }))
vi.mock('@/lib/docusign', () => ({ voidEnvelope: vi.fn() }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => null }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    rpc,
    from(table: string) {
      let op: 'select' | 'delete' = 'select'
      let counting = false
      const filters: Array<[string, unknown]> = []
      const run = () => {
        if (table === 'members' && counting) {
          const login = filters.find(([c]) => c === 'clerk_user_id')?.[1]
          return { count: members.filter((m) => m.clerk_user_id === login).length, error: null }
        }
        if (table === 'members') {
          const ids = filters.find(([c]) => c === 'id')?.[1] as string[]
          return { data: members.filter((m) => ids.includes(m.id as string)), error: null }
        }
        if (table === 'event_crew_check_ins' && op === 'delete') {
          const [column, values] = filters[0] as [keyof CrewRow, string[]]
          const gone = staff.filter((r) => values.includes(r[column] as string))
          staff = staff.filter((r) => !gone.includes(r))
          return { data: gone.map((r) => ({ id: r.id })), error: null }
        }
        throw new Error(`unexpected ${op} on ${table}`)
      }
      const chain: Record<string, unknown> = {
        select: (_c: string, opts?: { head?: boolean }) => { counting = !!opts?.head; return chain },
        delete: () => { op = 'delete'; return chain },
        eq: (c: string, v: unknown) => { filters.push([c, v]); return chain },
        neq: () => chain,
        in: (c: string, v: unknown) => { filters.push([c, v]); return chain },
        then: (f: (v: unknown) => unknown) => Promise.resolve(run()).then(f),
      }
      return chain
    },
  }),
}))

const member = (id: string, clerk_user_id: string | null) => ({
  id, membership_id: null, clerk_user_id, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  is_active: true, deleted_at: null, first_name: 'Sam', last_name: 'Lee', email: `${id.slice(0, 4)}@example.com`,
  date_of_birth: '1990-01-01',
})

/** What merge_members does to the rows this test watches, then its result. */
function mergeRpc(dropLogin: string | null) {
  rpc.mockImplementation(async () => {
    for (const r of staff) if (r.member_id === DROP) r.member_id = KEEP
    members = members.filter((m) => m.id !== DROP)
    return { data: { keptMemberId: KEEP, droppedMemberId: DROP, droppedClerkUserId: dropLogin }, error: null }
  })
}

const { POST } = await import('./route')

const merge = () => POST(new NextRequest('https://app.test/api/admin/members/merge', {
  method: 'POST',
  body: JSON.stringify({ keepId: KEEP, dropId: DROP, fields: {} }),
}))

beforeEach(() => {
  deleteUser.mockClear()
  for (const f of [getUser, updateUser, createEmailAddress, updateEmailAddress, deleteEmailAddress, logActivity]) f.mockClear()
  // By default the kept login's primary already matches the kept record's email.
  clerkUser = {
    id: KEEP_LOGIN,
    primaryEmailAddressId: 'idn_keep',
    emailAddresses: [{ id: 'idn_keep', emailAddress: `${KEEP.slice(0, 4)}@example.com`, verification: { status: 'verified' } }],
  }
  rpc.mockReset()
  staff = [
    { id: 's1', crew_key: `m.${DROP_LOGIN}`, member_id: null },
    { id: 's2', crew_key: `m.${KEEP_LOGIN}`, member_id: null },
    { id: 's3', crew_key: `v.${DROP}`, member_id: DROP },
    { id: 's4', crew_key: 'm.user_someone_else_placeholder', member_id: null },
  ]
})

describe('POST /api/admin/members/merge — crew check-ins of the dropped login', () => {
  it("deletes the dropped login and its event-manager check-ins; the kept login's and everyone else's survive", async () => {
    members = [member(KEEP, KEEP_LOGIN), member(DROP, DROP_LOGIN)]
    mergeRpc(DROP_LOGIN)
    const res = await merge()
    expect(res.status).toBe(200)
    expect(deleteUser).toHaveBeenCalledWith(DROP_LOGIN)
    expect((await res.json()).login).toMatchObject({ kind: 'clerk', ok: true })
    expect(staff.map((r) => r.id).sort()).toEqual(['s2', 's3', 's4'])
    // The dropped record's volunteer row moved to the kept member with the merge.
    expect(staff.find((r) => r.id === 's3')?.member_id).toBe(KEEP)
  })

  it('keeps the check-ins when the kept record takes over the login', async () => {
    members = [member(KEEP, null), member(DROP, DROP_LOGIN)]
    mergeRpc(DROP_LOGIN)
    const res = await merge()
    expect(res.status).toBe(200)
    expect(deleteUser).not.toHaveBeenCalled()
    expect(staff.map((r) => r.id).sort()).toEqual(['s1', 's2', 's3', 's4'])
  })
})

// Tracker member-merge-school-email.3: the merge changed members.email but the
// kept record's Clerk login kept the old (school) address as its primary.
describe("POST /api/admin/members/merge — the kept login's email follows the kept record", () => {
  const SCHOOL = 'student@district.k12.example.us'
  const PERSONAL = 'student.personal@example.com'

  const mergeWith = (fields: Record<string, unknown>) => POST(new NextRequest('https://app.test/api/admin/members/merge', {
    method: 'POST',
    body: JSON.stringify({ keepId: KEEP, dropId: DROP, fields }),
  }))

  beforeEach(() => {
    members = [
      { ...member(KEEP, KEEP_LOGIN), email: SCHOOL, school_email: null },
      { ...member(DROP, null), email: PERSONAL, school_email: null },
    ]
    clerkUser = {
      id: KEEP_LOGIN,
      primaryEmailAddressId: 'idn_school',
      emailAddresses: [{ id: 'idn_school', emailAddress: SCHOOL, verification: { status: 'verified' } }],
    }
    mergeRpc(null)
  })

  it('adds the kept email to the login as verified, makes it primary, and keeps a school address the member still has', async () => {
    const res = await mergeWith({ email: PERSONAL, school_email: SCHOOL })
    expect(res.status).toBe(200)
    expect(createEmailAddress).toHaveBeenCalledWith({ userId: KEEP_LOGIN, emailAddress: PERSONAL, verified: true })
    const created = clerkUser.emailAddresses.find((a) => a.emailAddress === PERSONAL)!
    expect(updateUser).toHaveBeenCalledWith(KEEP_LOGIN, { primaryEmailAddressID: created.id })
    // The member still holds the school address, so the login keeps it too.
    expect(deleteEmailAddress).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.loginEmail).toMatchObject({ ok: true, status: 'updated', removedOldAddress: false })
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ memberId: KEEP, action: 'login_email_updated' }))
  })

  it('removes the old address from the login when the merge removed it from the member', async () => {
    const res = await mergeWith({ email: PERSONAL, school_email: null })
    expect(res.status).toBe(200)
    expect(deleteEmailAddress).toHaveBeenCalledWith('idn_school')
    expect(clerkUser.emailAddresses.map((a) => a.emailAddress)).toEqual([PERSONAL])
    expect((await res.json()).loginEmail).toMatchObject({ ok: true, status: 'updated', removedOldAddress: true })
  })

  it('verifies and promotes an address the login already has instead of adding it again', async () => {
    clerkUser.emailAddresses.push({ id: 'idn_personal', emailAddress: PERSONAL, verification: { status: 'unverified' } })
    const res = await mergeWith({ email: PERSONAL, school_email: SCHOOL })
    expect(res.status).toBe(200)
    expect(createEmailAddress).not.toHaveBeenCalled()
    expect(updateEmailAddress).toHaveBeenCalledWith('idn_personal', { verified: true })
    expect(updateUser).toHaveBeenCalledWith(KEEP_LOGIN, { primaryEmailAddressID: 'idn_personal' })
  })

  it('makes no Clerk write when the login already has the new email as its primary', async () => {
    clerkUser.emailAddresses.push({ id: 'idn_personal', emailAddress: PERSONAL, verification: { status: 'verified' } })
    clerkUser.primaryEmailAddressId = 'idn_personal'
    const res = await mergeWith({ email: PERSONAL, school_email: null })
    expect(res.status).toBe(200)
    expect(getUser).toHaveBeenCalledWith(KEEP_LOGIN)
    expect(createEmailAddress).not.toHaveBeenCalled()
    expect(updateEmailAddress).not.toHaveBeenCalled()
    expect(updateUser).not.toHaveBeenCalled()
    expect(deleteEmailAddress).not.toHaveBeenCalled()
    expect((await res.json()).loginEmail).toMatchObject({ ok: true, status: 'unchanged' })
    expect(logActivity).not.toHaveBeenCalled()
  })

  it('makes no Clerk call when the merge keeps the email and the login the record already had', async () => {
    const res = await mergeWith({ email: SCHOOL })
    expect(res.status).toBe(200)
    expect(getUser).not.toHaveBeenCalled()
    expect(createEmailAddress).not.toHaveBeenCalled()
    expect(updateUser).not.toHaveBeenCalled()
    expect(await res.json()).not.toHaveProperty('loginEmail')
    expect(logActivity).not.toHaveBeenCalled()
  })

  it('checks the login the kept record inherits from the removed one', async () => {
    members = [{ ...member(KEEP, null), email: SCHOOL }, { ...member(DROP, DROP_LOGIN), email: PERSONAL }]
    clerkUser = {
      id: DROP_LOGIN,
      primaryEmailAddressId: 'idn_personal',
      emailAddresses: [{ id: 'idn_personal', emailAddress: PERSONAL, verification: { status: 'verified' } }],
    }
    mergeRpc(DROP_LOGIN)
    const res = await mergeWith({ email: SCHOOL })
    expect(res.status).toBe(200)
    expect(getUser).toHaveBeenCalledWith(DROP_LOGIN)
    expect(deleteUser).not.toHaveBeenCalled()
    expect(createEmailAddress).toHaveBeenCalledWith({ userId: DROP_LOGIN, emailAddress: SCHOOL, verified: true })
    // The member no longer holds the personal address, so the login lets it go.
    expect(deleteEmailAddress).toHaveBeenCalledWith('idn_personal')
    expect((await res.json()).loginEmail).toMatchObject({ ok: true, status: 'updated', removedOldAddress: true })
  })

  it('makes no Clerk call at all when the kept record has no login', async () => {
    members = [{ ...member(KEEP, null), email: SCHOOL }, { ...member(DROP, null), email: PERSONAL }]
    const res = await mergeWith({ email: PERSONAL })
    expect(res.status).toBe(200)
    expect(getUser).not.toHaveBeenCalled()
    expect((await res.json()).loginEmail).toMatchObject({ ok: true, status: 'no_login' })
  })

  it('reports and logs a Clerk failure instead of ignoring it; the merge still stands', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    createEmailAddress.mockRejectedValueOnce(Object.assign(new Error('Unprocessable Entity'), {
      errors: [{ message: 'taken', longMessage: 'That email address is taken. Please try another.' }],
    }))
    try {
      const res = await mergeWith({ email: PERSONAL, school_email: null })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.ok).toBe(true)
      expect(body.loginEmail).toMatchObject({ ok: false, status: 'failed', step: 'add the kept email to the login' })
      expect(body.loginEmail.detail).toContain('That email address is taken')
      // Nothing half-done: the primary did not move and the old address stays.
      expect(updateUser).not.toHaveBeenCalled()
      expect(deleteEmailAddress).not.toHaveBeenCalled()
      expect(consoleError).toHaveBeenCalledWith(
        '[admin/members/merge] login email update failed:',
        expect.objectContaining({ memberId: KEEP, step: 'add the kept email to the login' }),
      )
      expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ memberId: KEEP, action: 'login_email_update_failed' }))
      // The server log carries no addresses.
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(PERSONAL)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('reports a failure to remove the old address after the primary moved', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    deleteEmailAddress.mockRejectedValueOnce(new Error('Clerk unavailable'))
    try {
      const res = await mergeWith({ email: PERSONAL, school_email: null })
      const body = await res.json()
      expect(updateUser).toHaveBeenCalled()
      expect(body.loginEmail).toMatchObject({ ok: false, status: 'failed', step: 'remove the old address from the login' })
      expect(body.loginEmail.detail).toContain("now signs in with the kept record's email")
    } finally {
      consoleError.mockRestore()
    }
  })
})
