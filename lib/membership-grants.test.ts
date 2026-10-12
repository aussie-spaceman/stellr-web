import { describe, it, expect, vi, beforeEach } from 'vitest'

// grantTier, deep review PAY-11: paying a membership invoice must extend access
// even when the member already holds that tier via a complimentary / rule grant.
// Before the fix the already_active idempotency guard returned without extending,
// so a 12-month invoice was paid and access still ended when the comp row expired.

const { logActivity } = vi.hoisted(() => ({ logActivity: vi.fn(async () => {}) }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => { throw new Error('should pass an explicit client') } }))
vi.mock('@/lib/activity-log', () => ({ logActivity }))
vi.mock('@/lib/entitlements', () => ({ grantAdhocEntitlement: vi.fn(async () => 0) }))

import { grantTier } from '@/lib/membership-grants'

type Row = Record<string, unknown>

// A tiny Supabase stand-in: select/eq/maybeSingle reads, update(...).eq(...) writes
// (recorded + applied in place), insert(...).select().single() for the fresh path.
function makeDb(tables: Record<string, Row[]>) {
  const updates: { table: string; set: Row }[] = []
  const inserts: { table: string; rows: Row[] }[] = []
  function builder(table: string) {
    const filters: ((r: Row) => boolean)[] = []
    let pending: Row | null = null
    const matched = () => (tables[table] ??= []).filter((r) => filters.every((f) => f(r)))
    const run = () => {
      if (pending) {
        const rows = matched()
        for (const r of rows) Object.assign(r, pending)
        updates.push({ table, set: pending })
        return { data: rows, error: null }
      }
      return { data: matched(), error: null }
    }
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
      single: async () => ({ data: matched()[0] ?? null, error: null }),
      update: (set: Row) => ((pending = set), q),
      insert: (payload: Row | Row[]) => {
        const rows = (Array.isArray(payload) ? payload : [payload]).map((r, i) => ({ id: `${table}-${i}`, ...r }))
        inserts.push({ table, rows })
        ;(tables[table] ??= []).push(...rows)
        return q
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    }
    return q
  }
  return { db: { from: builder } as never, updates, inserts }
}

const TODAY = new Date().toISOString().split('T')[0]
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().split('T')[0]

beforeEach(() => vi.clearAllMocks())

describe('grantTier — PAY-11 paid extension of an already-active tier', () => {
  function seed() {
    return makeDb({
      membership_tiers: [{ id: 't1', name: 'Innovator', is_free: false }],
      member_memberships: [
        { id: 'mm1', member_id: 'm1', tier_id: 't1', renewal_status: 'active', expires_at: plusDays(30), is_complimentary: true, source: 'rule' },
      ],
    })
  }

  it('extends a comp row and flips it to paid when a Stripe invoice is paid', async () => {
    const { db, updates } = seed()

    const r = await grantTier({ memberId: 'm1', tierId: 't1', months: 12, source: 'stripe', replacesFree: true }, db)

    expect(r).toMatchObject({ granted: true, membershipId: 'mm1' })
    const set = updates.find((u) => u.table === 'member_memberships')!.set
    expect(set.is_complimentary).toBe(false)
    expect(set.source).toBe('stripe')
    // Extended from the comp's current expiry (today+30d), so well past today+12mo.
    expect(set.expires_at as string >= plusDays(365)).toBe(true)
  })

  it('leaves a non-paid (rule) grant as the idempotent no-op', async () => {
    const { db, updates } = seed()

    const r = await grantTier({ memberId: 'm1', tierId: 't1', months: 12, source: 'rule' }, db)

    expect(r).toMatchObject({ granted: false, reason: 'already_active', membershipId: 'mm1' })
    expect(updates.find((u) => u.table === 'member_memberships')).toBeUndefined()
  })

  it('extends from today when the existing row already lapsed', async () => {
    const { db, updates } = makeDb({
      membership_tiers: [{ id: 't1', name: 'Innovator', is_free: false }],
      // expires_at in the past → the active-and-unexpired guard does not match, so
      // the normal insert path runs (a fresh paid row), not the extend path.
      member_memberships: [
        { id: 'mm1', member_id: 'm1', tier_id: 't1', renewal_status: 'active', expires_at: plusDays(-5) },
      ],
    })

    const r = await grantTier({ memberId: 'm1', tierId: 't1', months: 12, source: 'stripe' }, db)

    expect(r.granted).toBe(true)
    // A new row was inserted rather than mm1 extended (mm1 was past expiry).
    expect(updates.find((u) => u.table === 'member_memberships')).toBeUndefined()
  })

  it('honours an explicit expiresAt over months when extending', async () => {
    const { db, updates } = seed()
    const target = plusDays(400)

    await grantTier({ memberId: 'm1', tierId: 't1', expiresAt: target, source: 'stripe' }, db)

    expect(updates.find((u) => u.table === 'member_memberships')!.set.expires_at).toBe(target)
  })
})
