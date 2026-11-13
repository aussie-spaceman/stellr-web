import { beforeEach, describe, expect, it, vi } from 'vitest'

// Member row + "other rows on this login" count the fake Supabase returns.
let memberRow: { clerk_user_id: string | null } | null
let otherLinked: number
// An in-memory event_staff_check_ins: the login removal deletes this login's
// event-manager check-ins once the login is gone (owner decision 13 Nov 2026).
type StaffRow = { id: string; staff_key: string; member_id: string | null }
let staffRows: StaffRow[]
let staffDeleteError: string | null

const getUser = vi.fn()
const deleteUser = vi.fn()

vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: async () => ({ users: { getUser, deleteUser } }),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const q = {
        select: (_cols: string, opts?: { head?: boolean }) => {
          const counting = !!opts?.head
          const chain = {
            eq: () => chain,
            neq: () => chain,
            maybeSingle: async () => (table === 'platform_admins' ? { data: null, error: { message: 'role table down' } } : { data: memberRow }),
            then: (resolve: (v: { count: number }) => unknown) =>
              resolve({ count: counting ? otherLinked : 0 }),
          }
          return chain
        },
        delete: () => ({
          in: (column: keyof StaffRow, values: string[]) => ({
            select: async () => {
              if (table !== 'event_staff_check_ins') throw new Error(`unexpected delete from ${table}`)
              if (staffDeleteError) return { data: null, error: { message: staffDeleteError } }
              const gone = staffRows.filter((r) => values.includes(r[column] as string))
              staffRows = staffRows.filter((r) => !gone.includes(r))
              return { data: gone.map((r) => ({ id: r.id })), error: null }
            },
          }),
        }),
      }
      return q
    },
  }),
}))

vi.mock('@/lib/docusign', () => ({ voidEnvelope: vi.fn() }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => null }))

const { cleanupClerkForMember, deleteUnsharedClerkLogin, runExternalCleanup } = await import('./external')
const { getEntityDef } = await import('./registry')

const staffKeysLeft = () => staffRows.map((r) => r.staff_key).sort()

beforeEach(() => {
  memberRow = { clerk_user_id: 'user_abc' }
  otherLinked = 0
  staffDeleteError = null
  staffRows = [
    { id: 's1', staff_key: 'm.user_abc', member_id: null },
    { id: 's2', staff_key: 'm.user_abc', member_id: null },
    { id: 's3', staff_key: 'm.user_someone_else', member_id: null },
    { id: 's4', staff_key: 'v.33333333-3333-4333-8333-333333333333', member_id: '33333333-3333-4333-8333-333333333333' },
  ]
  getUser.mockReset().mockResolvedValue({ publicMetadata: {} })
  deleteUser.mockReset().mockResolvedValue({})
})

describe('cleanupClerkForMember', () => {
  it('deletes the linked Clerk login', async () => {
    const r = await cleanupClerkForMember('m1')
    expect(deleteUser).toHaveBeenCalledWith('user_abc')
    expect(r).toMatchObject({ kind: 'clerk', ok: true })
  })

  it('does nothing when no login is linked', async () => {
    memberRow = { clerk_user_id: null }
    const r = await cleanupClerkForMember('m1')
    expect(deleteUser).not.toHaveBeenCalled()
    expect(r.ok).toBe(true)
  })

  it('leaves a login that another member row still uses', async () => {
    otherLinked = 1
    const r = await cleanupClerkForMember('m1')
    expect(deleteUser).not.toHaveBeenCalled()
    expect(r.ok).toBe(false)
  })

  it.each(['admin', 'event_manager'])('never deletes a %s login', async (role) => {
    getUser.mockResolvedValue({ publicMetadata: { role } })
    const r = await cleanupClerkForMember('m1')
    expect(deleteUser).not.toHaveBeenCalled()
    expect(r.ok).toBe(false)
    expect(r.detail).toBe(`Clerk login user_abc is a staff account (${role}); left in place`)
  })

  it.each(['student', 'staff', 'Admin', 7, undefined])('deletes a login whose role is %s', async (role) => {
    getUser.mockResolvedValue({ publicMetadata: { role } })
    const r = await cleanupClerkForMember('m1')
    expect(deleteUser).toHaveBeenCalledWith('user_abc')
    expect(r.ok).toBe(true)
  })

  it('reports a failed role read and deletes nothing', async () => {
    getUser.mockRejectedValue(Object.assign(new Error('Clerk unavailable'), { status: 503 }))
    const r = await cleanupClerkForMember('m1')
    expect(deleteUser).not.toHaveBeenCalled()
    expect(r).toMatchObject({ kind: 'clerk', ok: false, detail: 'Clerk unavailable' })
  })

  it('under postgres, a failed role read keeps the login and says it could not confirm, not that it is staff', async () => {
    vi.stubEnv('AUTHZ_SOURCE', 'postgres')
    try {
      const r = await cleanupClerkForMember('m1')
      expect(deleteUser).not.toHaveBeenCalled()
      expect(r).toMatchObject({ kind: 'clerk', ok: false, detail: 'Could not confirm Clerk login user_abc is not a staff account; left in place' })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('treats a login already removed from Clerk as done', async () => {
    getUser.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
    const r = await cleanupClerkForMember('m1')
    expect(deleteUser).not.toHaveBeenCalled()
    expect(r.ok).toBe(true)
  })

  it('reports a Clerk failure instead of throwing', async () => {
    deleteUser.mockRejectedValue(new Error('Clerk down'))
    const r = await cleanupClerkForMember('m1')
    expect(r).toMatchObject({ kind: 'clerk', ok: false, detail: 'Clerk down' })
  })
})

describe('runExternalCleanup — member', () => {
  const member = getEntityDef('member')!

  it('removes the Clerk login on a hard delete', async () => {
    const results = await runExternalCleanup(member, 'm1', 'hard')
    expect(results.some((r) => r.kind === 'clerk')).toBe(true)
    expect(deleteUser).toHaveBeenCalledOnce()
  })

  it('keeps the Clerk login on a soft delete', async () => {
    const results = await runExternalCleanup(member, 'm1', 'soft')
    expect(results.some((r) => r.kind === 'clerk')).toBe(false)
    expect(deleteUser).not.toHaveBeenCalled()
  })
})

// Owner decision 13 Nov 2026 (tracker attendee-email-cohort.4): event staff
// check-ins leave with the account. The login removal is shared by the member
// hard delete (and the pending-consent purge and privacy requests through it)
// and the member merge.
describe('login removal takes its event-manager check-ins with it', () => {
  const OTHERS = ['m.user_someone_else', 'v.33333333-3333-4333-8333-333333333333']

  it("removes the deleted login's m.<id> rows, and every other person's survive", async () => {
    const r = await cleanupClerkForMember('m1')
    expect(deleteUser).toHaveBeenCalledWith('user_abc')
    expect(r).toEqual({ kind: 'clerk', ok: true, detail: 'Deleted Clerk login user_abc' })
    expect(staffKeysLeft()).toEqual(OTHERS)
  })

  it('removes them when the login was already gone from Clerk', async () => {
    getUser.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
    const r = await cleanupClerkForMember('m1')
    expect(r).toEqual({ kind: 'clerk', ok: true, detail: 'Clerk login already removed' })
    expect(staffKeysLeft()).toEqual(OTHERS)
  })

  it('removes them for the merge, which names the dropped login directly', async () => {
    const r = await deleteUnsharedClerkLogin('user_abc')
    expect(r.ok).toBe(true)
    expect(staffKeysLeft()).toEqual(OTHERS)
  })

  it('keeps them while the login stays: a staff account', async () => {
    getUser.mockResolvedValue({ publicMetadata: { role: 'event_manager' } })
    await cleanupClerkForMember('m1')
    expect(staffRows).toHaveLength(4)
  })

  it('keeps them while the login stays: another member still uses it', async () => {
    otherLinked = 1
    await cleanupClerkForMember('m1')
    expect(staffRows).toHaveLength(4)
  })

  it('keeps them when Clerk refused the delete', async () => {
    deleteUser.mockRejectedValue(new Error('Clerk down'))
    await cleanupClerkForMember('m1')
    expect(staffRows).toHaveLength(4)
  })

  it('touches nothing when the member has no login', async () => {
    memberRow = { clerk_user_id: null }
    await cleanupClerkForMember('m1')
    expect(staffRows).toHaveLength(4)
  })

  it('reports a failed check-in delete to the admin after the login is gone', async () => {
    staffDeleteError = 'connection reset'
    const r = await cleanupClerkForMember('m1')
    expect(deleteUser).toHaveBeenCalledWith('user_abc')
    expect(r).toEqual({
      kind: 'clerk',
      ok: false,
      detail: 'Deleted Clerk login user_abc, but its event check-ins were not removed (event_staff_check_ins: connection reset)',
    })
  })

  it('a member hard delete through the registry removes them; a soft delete does not', async () => {
    const member = getEntityDef('member')!
    await runExternalCleanup(member, 'm1', 'soft')
    expect(staffRows).toHaveLength(4)
    await runExternalCleanup(member, 'm1', 'hard')
    expect(staffKeysLeft()).toEqual(OTHERS)
  })

  it('the pending-consent purge (run as a member) removes them', async () => {
    const pending = getEntityDef('pending_consent_member')!
    await runExternalCleanup({ ...pending, type: pending.actsAs! }, 'm1', 'hard')
    expect(staffKeysLeft()).toEqual(OTHERS)
  })
})
