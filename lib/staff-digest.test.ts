import { describe, expect, it } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { isQuarterReviewWeek, loadStaffDigest, unusualViewers, UNUSUAL_MINOR_VIEWS } from './staff-digest'

describe('staff digest builders', () => {
  it('a quarterly review falls in the first week of January, April, July and October only', () => {
    for (const d of ['2027-01-03', '2027-04-07', '2027-07-01', '2027-10-05']) expect(isQuarterReviewWeek(new Date(`${d}T12:00:00Z`)), d).toBe(true)
    for (const d of ['2027-01-08', '2027-02-02', '2027-11-01', '2026-12-31']) expect(isQuarterReviewWeek(new Date(`${d}T12:00:00Z`)), d).toBe(false)
  })
  it('calls out only accounts above the threshold, most views first', () => {
    const rows = [
      ...Array.from({ length: UNUSUAL_MINOR_VIEWS + 5 }, () => ({ actor: 'u_a', actor_role: 'staff' })),
      ...Array.from({ length: UNUSUAL_MINOR_VIEWS + 20 }, () => ({ actor: 'u_b', actor_role: 'admin' })),
      ...Array.from({ length: UNUSUAL_MINOR_VIEWS }, () => ({ actor: 'u_c', actor_role: 'staff' })),
    ]
    expect(unusualViewers(rows)).toEqual([
      { actor: 'u_b', role: 'admin', views: UNUSUAL_MINOR_VIEWS + 20 },
      { actor: 'u_a', role: 'staff', views: UNUSUAL_MINOR_VIEWS + 5 },
    ])
  })
})

describe('loadStaffDigest', () => {
  const W = { start: '2026-11-07T00:00:00Z', end: '2026-11-14T00:00:00Z' }
  it('lists waiting and ending grants, counts exports by role, and names over-readers from members', async () => {
    const views = Array.from({ length: UNUSUAL_MINOR_VIEWS + 1 }, (_, i) => ({ id: `v${i}`, at: '2026-11-10T00:00:00Z', actor: 'user_x', actor_role: 'staff', action: 'minor_record_view' }))
    const db = fakeSupabase({
      staff_grants: [
        { member_id: 'm1', status: 'pending', missing: ['mfa'], granted_at: '2026-11-01T00:00:00Z', expires_at: null, members: { first_name: 'Ana', last_name: 'B' } },
        { member_id: 'm2', status: 'active', missing: [], granted_at: '2024-01-01T00:00:00Z', expires_at: '2026-12-20T00:00:00Z', members: { first_name: 'Cy', last_name: 'D' } },
        { member_id: 'm3', status: 'active', missing: [], granted_at: '2026-01-01T00:00:00Z', expires_at: '2029-01-01T00:00:00Z', members: { first_name: 'Ed', last_name: 'F' } },
      ],
      record_access_log: [
        { id: 'e1', at: '2026-11-09T00:00:00Z', actor: 'user_y', actor_role: 'staff', action: 'export' },
        { id: 'e2', at: '2026-11-09T00:00:00Z', actor: 'user_z', actor_role: 'admin', action: 'export' },
        { id: 'e0', at: '2026-10-01T00:00:00Z', actor: 'user_z', actor_role: 'admin', action: 'export' },
        ...views,
      ],
      members: [{ clerk_user_id: 'user_x', first_name: 'Gil', last_name: 'H' }],
    })
    const d = await loadStaffDigest(db.client, W, new Date('2026-11-14T12:00:00Z'))
    expect(d.pending).toEqual([{ memberId: 'm1', name: 'Ana B', missing: ['mfa'], since: '2026-11-01T00:00:00Z' }])
    expect(d.expiringSoon).toEqual([{ memberId: 'm2', name: 'Cy D', expiresAt: '2026-12-20T00:00:00Z' }])
    expect(d.exports).toEqual({ total: 2, byRole: { staff: 1, admin: 1 } })
    expect(d.unusualViewers).toEqual([{ name: 'Gil H', role: 'staff', views: UNUSUAL_MINOR_VIEWS + 1 }])
    expect(d.quarterlyReview).toBeNull()
  })
})
