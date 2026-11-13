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

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: 'user_admin_placeholder' }),
  clerkClient: async () => ({ users: { deleteUser } }),
}))
vi.mock('@/lib/admin-auth', () => ({ currentUserIsAdmin: async () => true }))
vi.mock('@/lib/activity-log', () => ({ actorFromAuth: async () => ({ actorMemberId: null, actorLabel: 'admin' }) }))
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
