import type { SupabaseClient } from '@supabase/supabase-js'

// The Staff section of the Friday digest (Staff role phase 4, 14 Nov 2026).
//
// What leading practice asks an owner to look at regularly, for a role with
// privileged access to minors' records:
//   - grants waiting on a prerequisite, and access ending within 60 days;
//   - the week's exports, by role;
//   - anyone who viewed far more minors' records than usual (a quiet over-reader
//     is what an access log is for);
//   - at the start of each quarter, every active Staff grant, for an access review.
// Pure builders plus one loader; names come from members, never from the log.

/** Minor-record views in a week above which an account is called out. Tune with experience. */
export const UNUSUAL_MINOR_VIEWS = 60

export interface StaffDigest {
  pending: Array<{ memberId: string; name: string; missing: string[]; since: string }>
  expiringSoon: Array<{ memberId: string; name: string; expiresAt: string }>
  exports: { total: number; byRole: Record<string, number> }
  unusualViewers: Array<{ name: string; role: string; views: number }>
  /** Every active grant, only in the first week of a quarter; null otherwise. */
  quarterlyReview: Array<{ memberId: string; name: string; expiresAt: string | null }> | null
}

export const EMPTY_STAFF_DIGEST: StaffDigest = { pending: [], expiringSoon: [], exports: { total: 0, byRole: {} }, unusualViewers: [], quarterlyReview: null }

/** The first seven days of January, April, July or October. Pure. */
export function isQuarterReviewWeek(now: Date): boolean {
  return now.getUTCMonth() % 3 === 0 && now.getUTCDate() <= 7
}

/** Accounts over the threshold, most views first. Pure. */
export function unusualViewers(rows: Array<{ actor: string; actor_role: string }>, threshold = UNUSUAL_MINOR_VIEWS): Array<{ actor: string; role: string; views: number }> {
  const counts = new Map<string, { role: string; views: number }>()
  for (const r of rows) {
    const c = counts.get(r.actor) ?? { role: r.actor_role, views: 0 }
    c.views++
    counts.set(r.actor, c)
  }
  return [...counts].filter(([, c]) => c.views > threshold).map(([actor, c]) => ({ actor, ...c })).sort((a, b) => b.views - a.views)
}

const nameOf = (m: { first_name?: string | null; last_name?: string | null } | null | undefined) =>
  `${m?.first_name ?? ''} ${m?.last_name ?? ''}`.trim() || 'A member'

async function read<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, label: string): Promise<T[]> {
  const { data, error } = await q
  if (error) throw new Error(`${label}: ${error.message}`)
  return (data ?? []) as T[]
}

export async function loadStaffDigest(db: SupabaseClient, window: { start: string; end: string }, now: Date = new Date()): Promise<StaffDigest> {
  const in60 = new Date(now.getTime() + 60 * 86_400_000).toISOString()
  type Grant = { member_id: string; status: string; missing: string[] | null; granted_at: string; expires_at: string | null; members: { first_name: string | null; last_name: string | null } | null }
  const [grants, exports, views] = await Promise.all([
    read<Grant>(db.from('staff_grants').select('member_id, status, missing, granted_at, expires_at, members:member_id(first_name, last_name)').in('status', ['pending', 'active', 'suspended']), 'staff grants'),
    read<{ actor_role: string }>(db.from('record_access_log').select('actor_role').eq('action', 'export').gte('at', window.start).lt('at', window.end), 'exports'),
    read<{ actor: string; actor_role: string }>(db.from('record_access_log').select('actor, actor_role').eq('action', 'minor_record_view').gte('at', window.start).lt('at', window.end).limit(20_000), 'minor views'),
  ])

  const byRole: Record<string, number> = {}
  for (const e of exports) byRole[e.actor_role] = (byRole[e.actor_role] ?? 0) + 1

  // Name the over-readers from members by their Clerk id; the log holds only the id.
  const flagged = unusualViewers(views)
  const names = new Map<string, string>()
  if (flagged.length) {
    const people = await read<{ clerk_user_id: string; first_name: string | null; last_name: string | null }>(
      db.from('members').select('clerk_user_id, first_name, last_name').in('clerk_user_id', flagged.map((f) => f.actor)),
      'viewer names',
    )
    for (const p of people) names.set(p.clerk_user_id, nameOf(p))
  }

  return {
    pending: grants.filter((g) => g.status !== 'active').map((g) => ({ memberId: g.member_id, name: nameOf(g.members), missing: g.missing ?? [], since: g.granted_at })),
    expiringSoon: grants.filter((g) => g.status === 'active' && g.expires_at && g.expires_at <= in60).map((g) => ({ memberId: g.member_id, name: nameOf(g.members), expiresAt: g.expires_at as string })),
    exports: { total: exports.length, byRole },
    unusualViewers: flagged.map((f) => ({ name: names.get(f.actor) ?? 'An account with no member record', role: f.role, views: f.views })),
    quarterlyReview: isQuarterReviewWeek(now)
      ? grants.filter((g) => g.status === 'active').map((g) => ({ memberId: g.member_id, name: nameOf(g.members), expiresAt: g.expires_at }))
      : null,
  }
}
