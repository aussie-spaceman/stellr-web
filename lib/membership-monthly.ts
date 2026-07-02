import { getResolvedTierPricing } from '@/lib/tier-pricing'

// Monthly billing is offered only on the four school/college paid tiers. The
// amount comes from the same Stripe-first resolver as the annual price
// (lib/tier-pricing) — so the /membership toggle and /join price always match
// what Stripe charges, and a Stripe price edit propagates everywhere at once.
// (stripe_price_id_monthly is what's CHARGED; this now reads that same price.)

function format(cents: number): string {
  return cents % 100 === 0
    ? '$' + (cents / 100).toLocaleString('en-US')
    : '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** tier name → formatted monthly price (e.g. "Pathfinder" → "$6"). Only tiers with a monthly price. */
export async function getMonthlyPriceMap(): Promise<Record<string, string>> {
  const resolved = await getResolvedTierPricing()
  const out: Record<string, string> = {}
  for (const [name, p] of Object.entries(resolved)) {
    if (p.monthlyCents && p.monthlyCents > 0) out[name] = format(p.monthlyCents)
  }
  return out
}
