import { beforeEach, describe, expect, it, vi } from 'vitest'

// Member row + "other rows on this login" count the fake Supabase returns.
let memberRow: { clerk_user_id: string | null } | null
let otherLinked: number

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
      }
      return q
    },
  }),
}))

vi.mock('@/lib/docusign', () => ({ voidEnvelope: vi.fn() }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => null }))

const { cleanupClerkForMember, runExternalCleanup } = await import('./external')
const { getEntityDef } = await import('./registry')

beforeEach(() => {
  memberRow = { clerk_user_id: 'user_abc' }
  otherLinked = 0
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
