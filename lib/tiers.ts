// ─── Membership tiers (the real replacement for the prototype's `TIERS` map) ──
//
// The Spaces design groups the 9 membership tiers into three columns — High
// School / College / Teacher — for the admin "Access & tiers" checkbox grid and
// for the tier pills shown on posts and member cards. The names below are the
// LIVE canonical tier names (membership_tiers.name); the 10-tier / 3-family schema
// is sourced from Operations/Content Plan.xlsx and applied in migration 094. The
// prototype placeholders (Explorer/Pioneer/Voyager, etc.) are replaced here.
// Retired tiers (removed in migration 094, not used): Luminary, Counsellor
// (British spelling), Advisor, Donor, Expert.
//
// This module is PURE (no server imports) so client components — tier pills,
// access grids — can import it. The DB id↔name resolver lives in
// `lib/tiers-server.ts`. Tier *names* are the stable identity in code; tier *ids*
// (uuids) are resolved at runtime, so a tier rename never breaks Spaces.

export type TierGroupKey = 'high_school' | 'college' | 'teacher'

export interface TierGroup {
  key: TierGroupKey
  /** Column heading in the access grid. */
  label: string
  /** Tier names in ascending order (free → top paid). */
  tierNames: string[]
}

export const TIER_GROUPS: TierGroup[] = [
  { key: 'high_school', label: 'High School', tierNames: ['Explorer', 'Pathfinder', 'Scholar'] },
  { key: 'college',     label: 'College',     tierNames: ['Alumni', 'Contributor', 'Counselor'] },
  { key: 'teacher',     label: 'Teacher',     tierNames: ['Educator', 'Catalyst', 'Innovator', 'Trailblazer'] },
]

/** Every Spaces-relevant tier name, in display order. */
export const ALL_TIER_NAMES: string[] = TIER_GROUPS.flatMap((g) => g.tierNames)

/** The group a tier name belongs to (for pill colour / grouping), or null. */
export function tierGroupOf(tierName: string): TierGroupKey | null {
  for (const g of TIER_GROUPS) if (g.tierNames.includes(tierName)) return g.key
  return null
}

/** Accent colour per tier group, for tier pills. */
export const TIER_GROUP_COLOR: Record<TierGroupKey, { fg: string; bg: string }> = {
  high_school: { fg: '#2C53C6', bg: '#EAF0FE' }, // blue
  college:     { fg: '#0E7C88', bg: '#E2F6F8' }, // teal
  teacher:     { fg: '#6A45E0', bg: '#F1ECFF' }, // violet
}

export interface TierRow {
  id: string
  name: string
  is_free: boolean
}

export interface TierMap {
  /** All Spaces tiers as rows, in display order. */
  rows: TierRow[]
  /** name → id */
  idByName: Record<string, string>
  /** id → name */
  nameById: Record<string, string>
  /** id → group key */
  groupById: Record<string, TierGroupKey>
}

/**
 * Human-readable list of the tiers that can access a space, given the assigned
 * tier ids — used by the "Requires {tier list}" copy on Restricted/locked cards.
 */
export function describeAssignedTiers(tierIds: string[], nameById: Record<string, string>): string {
  const names = tierIds.map((id) => nameById[id]).filter(Boolean)
  if (names.length === 0) return 'a membership tier'
  names.sort((a, b) => ALL_TIER_NAMES.indexOf(a) - ALL_TIER_NAMES.indexOf(b))
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}
