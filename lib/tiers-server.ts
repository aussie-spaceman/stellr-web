import { supabaseServer } from '@/lib/supabase'
import { TIER_GROUPS, ALL_TIER_NAMES, type TierMap, type TierRow } from '@/lib/tiers'

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
