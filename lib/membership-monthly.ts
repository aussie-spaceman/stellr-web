import { unstable_cache } from 'next/cache'
import { supabaseServer } from '@/lib/supabase'

// Monthly billing is offered only on the four school/college paid tiers
// (monthly_cost_cents is set in migration 116; teacher + free tiers stay null).
// The amount is read from the DB — mirroring annual_cost_cents (lib/tier-pricing)
// — so the /membership toggle and /join price never depend on a live Stripe call
// at render time. stripe_price_id_monthly remains the source of truth for what is
// CHARGED at checkout; keep the cents in sync if a monthly price changes.

function format(cents: number): string {
  return cents % 100 === 0
    ? '$' + (cents / 100).toLocaleString('en-US')
    : '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** tier name → formatted monthly price (e.g. "Pathfinder" → "$5"). Only tiers with a monthly price. */
export const getMonthlyPriceMap = unstable_cache(
  async (): Promise<Record<string, string>> => {
    const db = supabaseServer()
    const { data } = await db
      .from('membership_tiers')
      .select('name, monthly_cost_cents')
      .not('monthly_cost_cents', 'is', null)

    const out: Record<string, string> = {}
    for (const r of (data ?? []) as Array<{ name: string; monthly_cost_cents: number }>) {
      if (r.monthly_cost_cents > 0) out[r.name] = format(r.monthly_cost_cents)
    }
    return out
  },
  ['membership-monthly-prices'],
  { revalidate: 3600 },
)
