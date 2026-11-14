// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Tracker training-resources-space-tab.5: revoking a membership failed on
// production because the route wrote renewal_status = 'revoked', which the
// membership_renewal_status enum (active, pending_renewal, expired, cancelled,
// complimentary) does not hold. The route now writes only enum values: a revoke
// and a cancel (either spelling) both store 'cancelled'.

const MEMBER = '11111111-1111-4111-8111-111111111111'
const MEMBERSHIP = '22222222-2222-4222-8222-222222222222'

// The values Postgres accepts for member_memberships.renewal_status.
const ENUM = ['active', 'pending_renewal', 'expired', 'cancelled', 'complimentary']

const { state } = vi.hoisted(() => ({
  state: {
    row: null as Record<string, unknown> | null,
    updates: [] as Record<string, unknown>[],
    logs: [] as Record<string, unknown>[],
  },
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ sessionClaims: {} }) }))
vi.mock('@/lib/authz', () => ({ hasCapability: async () => true }))
vi.mock('@/lib/activity-log', () => ({
  actorFromAuth: async () => ({ actorMemberId: null, actorLabel: 'admin' }),
  logActivity: async (entry: Record<string, unknown>) => { state.logs.push(entry) },
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from(table: string) {
      if (table !== 'member_memberships') throw new Error(`unexpected table ${table}`)
      let update: Record<string, unknown> | null = null
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        update: (u: Record<string, unknown>) => { update = u; return chain },
        maybeSingle: async () => ({ data: state.row, error: null }),
        then: (f: (v: unknown) => unknown) => {
          if (!update) throw new Error('awaited a chain with no update')
          // Postgres rejects a value outside the enum; so does this stand-in.
          const status = update.renewal_status
          if (status !== undefined && !ENUM.includes(status as string)) {
            return Promise.resolve({
              error: { code: '22P02', message: `invalid input value for enum membership_renewal_status: "${String(status)}"` },
            }).then(f)
          }
          state.updates.push(update)
          return Promise.resolve({ error: null }).then(f)
        },
      }
      return chain
    },
  }),
}))

const { PATCH, DELETE } = await import('./route')

const ctx = { params: Promise.resolve({ id: MEMBER, membershipId: MEMBERSHIP }) }
const url = `https://app.test/api/admin/members/${MEMBER}/memberships/${MEMBERSHIP}`
const patch = (body: Record<string, unknown>) =>
  PATCH(new Request(url, { method: 'PATCH', body: JSON.stringify(body) }), ctx)

beforeEach(() => {
  state.row = {
    id: MEMBERSHIP, expires_at: '2027-01-01', renewal_status: 'active', is_complimentary: false,
    membership_tiers: { name: 'Explorer' },
  }
  state.updates = []
  state.logs = []
})

describe('DELETE (revoke) — writes a value the enum holds', () => {
  it("stores 'cancelled', keeps the row, and records the revoke under its own action name", async () => {
    const res = await DELETE(new Request(url, { method: 'DELETE' }), ctx)
    expect(res.status).toBe(200)
    expect(state.updates).toEqual([{ renewal_status: 'cancelled' }])
    expect(state.logs).toHaveLength(1)
    expect(state.logs[0]).toMatchObject({
      action: 'tier_revoked',
      category: 'membership',
      metadata: { membershipId: MEMBERSHIP, renewal_status: 'cancelled', previous_status: 'active' },
    })
  })

  it('404s for a membership that is not this member’s', async () => {
    state.row = null
    const res = await DELETE(new Request(url, { method: 'DELETE' }), ctx)
    expect(res.status).toBe(404)
    expect(state.updates).toEqual([])
  })
})

describe('PATCH renewal_status — maps cancel and revoke onto the enum', () => {
  it.each([
    ['cancelled', 'cancelled'],
    ['canceled', 'cancelled'],
    ['revoked', 'cancelled'],
    ['Cancelled', 'cancelled'],
  ])("'%s' is stored as '%s'", async (input, stored) => {
    const res = await patch({ renewal_status: input })
    expect(res.status).toBe(200)
    expect(state.updates).toEqual([{ renewal_status: stored }])
    expect(state.logs[0]).toMatchObject({ action: 'tier_updated', summary: expect.stringContaining(`status → ${stored}`) })
  })

  it.each(ENUM)("accepts the enum value '%s' as is", async (value) => {
    const res = await patch({ renewal_status: value })
    expect(res.status).toBe(200)
    expect(state.updates).toEqual([{ renewal_status: value }])
  })

  it.each(['paused', '', null, 42])('rejects %j with a 400 and writes nothing', async (value) => {
    const res = await patch({ renewal_status: value })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid renewal_status' })
    expect(state.updates).toEqual([])
    expect(state.logs).toEqual([])
  })

  it('still edits expiry and the complimentary flag alongside the status', async () => {
    const res = await patch({ expires_at: '2028-06-30', renewal_status: 'canceled', is_complimentary: true })
    expect(res.status).toBe(200)
    expect(state.updates).toEqual([{ expires_at: '2028-06-30', renewal_status: 'cancelled', is_complimentary: true }])
  })
})
