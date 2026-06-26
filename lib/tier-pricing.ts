import { supabaseServer } from '@/lib/supabase'

// ─── Membership tier pricing (single source of truth) ────────────────────────
//
// Public marketing surfaces (homepage, /membership, compare table, /competitions)
// must NEVER hard-code tier prices — doing so caused the same tier to show three
// different prices across pages. Prices live in membership_tiers (canonical values
// applied in migration 094) and are read through this helper. Server-only.

export interface TierPrice {
  name: string
  annualCostCents: number
  isFree: boolean
}

export type TierPriceMap = Record<string, TierPrice>

/** name → price for every tier. Use with formatTierPrice() for display. */
export async function getTierPriceMap(): Promise<TierPriceMap> {
  const db = supabaseServer()
  const { data } = await db
    .from('membership_tiers')
    .select('name, annual_cost_cents, is_free')

  const out: TierPriceMap = {}
  for (const r of (data ?? []) as Array<{ name: string; annual_cost_cents: number | null; is_free: boolean }>) {
    out[r.name] = { name: r.name, annualCostCents: r.annual_cost_cents ?? 0, isFree: r.is_free }
  }
  return out
}

/** "$59" / "$1,000" from a tier's price; "Free" when free or zero-cost. */
export function formatTierPrice(price: TierPrice | undefined): string {
  if (!price || price.isFree || price.annualCostCents === 0) return 'Free'
  return '$' + Math.round(price.annualCostCents / 100).toLocaleString('en-US')
}
