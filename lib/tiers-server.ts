import { supabaseServer } from '@/lib/supabase'
import { TIER_GROUPS, ALL_TIER_NAMES, tierAllowedForBracket, type TierMap, type TierRow } from '@/lib/tiers'

/**
 * Bracket-compatibility guard for tier grants (admin/access convergence).
 * Resolves the tier's name and the member's age bracket, then applies
 * TIERS_BY_BRACKET. Returns { ok: true } or { ok: false, reason } — the admin
 * grant routes 400 on failure; the greyed chips on the Person 360 mirror this.
 * Rule-driven grants are validated at rule-save time instead (Rules tab).
 */
export async function checkTierAllowedForMember(
  memberId: string,
  tierId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const db = supabaseServer()
  const [{ data: tier }, { data: member }] = await Promise.all([
    db.from('membership_tiers').select('name').eq('id', tierId).maybeSingle(),
    db.from('members').select('age_bracket').eq('id', memberId).maybeSingle(),
  ])
  if (!tier) return { ok: false, reason: 'Unknown tier' }
  if (!member) return { ok: false, reason: 'Unknown member' }
  if (!tierAllowedForBracket(tier.name, member.age_bracket)) {
    return {
      ok: false,
      reason: `${tier.name} is not available to ${String(member.age_bracket).replace('_', ' ')} members`,
    }
  }
  return { ok: true }
}

/**
 * Resolve the live membership tiers into id/name lookups for the access grid and
 * tier pills. Only the 9 grouped tiers are returned (Guest/Subscriber and any
 * legacy rows are excluded), ordered to match TIER_GROUPS. Server-only.
 */
export async function resolveTierMap(): Promise<TierMap> {
  const db = supabaseServer()
  const { data } = await db
    .from('membership_tiers')
    .select('id, name, is_free')
    .in('name', ALL_TIER_NAMES)

  const byName = new Map<string, TierRow>()
  for (const r of (data ?? []) as TierRow[]) byName.set(r.name, r)

  const rows: TierRow[] = []
  const idByName: Record<string, string> = {}
  const nameById: Record<string, string> = {}
  const groupById: TierMap['groupById'] = {}

  for (const g of TIER_GROUPS) {
    for (const name of g.tierNames) {
      const row = byName.get(name)
      if (!row) continue // tier not present in this DB — skip gracefully
      rows.push(row)
      idByName[name] = row.id
      nameById[row.id] = name
      groupById[row.id] = g.key
    }
  }

  return { rows, idByName, nameById, groupById }
}

/**
 * Batch-resolve every active (unexpired) tier id held by each member. Used to
 * evaluate space access for a group of students (teacher Group spaces view).
 */
export async function getActiveTierIdsByMember(memberIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (memberIds.length === 0) return out

  const db = supabaseServer()
  const today = new Date().toISOString().split('T')[0]
  const { data } = await db
    .from('member_memberships')
    .select('member_id, tier_id, expires_at, renewal_status')
    .in('member_id', memberIds)
    .eq('renewal_status', 'active')

  for (const m of (data ?? []) as Array<{ member_id: string; tier_id: string | null; expires_at: string | null }>) {
    if (!m.tier_id) continue
    if (m.expires_at && m.expires_at < today) continue
    const arr = out.get(m.member_id) ?? []
    if (!arr.includes(m.tier_id)) arr.push(m.tier_id)
    out.set(m.member_id, arr)
  }
  return out
}

/**
 * Batch-resolve each member's primary active (unexpired) tier name. Used for tier
 * pills on the Members grid and elsewhere a list of members is shown.
 */
export async function getActiveTierNames(memberIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (memberIds.length === 0) return out

  const db = supabaseServer()
  const today = new Date().toISOString().split('T')[0]
  const { data } = await db
    .from('member_memberships')
    .select('member_id, started_at, expires_at, renewal_status, membership_tiers(name)')
    .in('member_id', memberIds)
    .eq('renewal_status', 'active')

  const best = new Map<string, { started: number; name: string }>()
  for (const m of (data ?? []) as Array<{
    member_id: string
    started_at: string
    expires_at: string | null
    membership_tiers: { name: string } | { name: string }[] | null
  }>) {
    if (m.expires_at && m.expires_at < today) continue
    const tier = Array.isArray(m.membership_tiers) ? m.membership_tiers[0] : m.membership_tiers
    if (!tier?.name) continue
    const started = new Date(m.started_at).getTime()
    const cur = best.get(m.member_id)
    if (!cur || started > cur.started) best.set(m.member_id, { started, name: tier.name })
  }
  for (const [id, v] of best) out.set(id, v.name)
  return out
}
