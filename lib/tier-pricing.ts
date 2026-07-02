import { unstable_cache } from 'next/cache'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'

// ─── Membership tier pricing (single source of truth) ────────────────────────
//
// Public marketing surfaces (homepage, /membership, /join, /competitions) must
// NEVER hard-code tier prices. They read through this helper, which resolves the
// LIVE Stripe price for each tier — the same source the admin Membership Studio
// and checkout use — so the price shown always matches the price charged. The
// membership_tiers cents columns (annual_cost_cents / monthly_cost_cents) are
// kept only as a fallback for when Stripe is unavailable or unconfigured.
//
// Result is cached with a short (60s) self-revalidating window, so a Stripe
// price edit reflects site-wide within ~a minute with no manual sync. The cache
// is also tagged (MEMBERSHIP_PRICES_TAG) so an on-demand revalidateTag can bust
// it instantly if we ever wire one up. Server-only.

/** Cache tag for the resolved pricing (for optional on-demand revalidation). */
export const MEMBERSHIP_PRICES_TAG = 'membership-prices'

export interface TierPrice {
  name: string
  annualCostCents: number
  isFree: boolean
}

export type TierPriceMap = Record<string, TierPrice>

/** Live-resolved price for a tier: Stripe-first, DB-cents fallback. */
export interface ResolvedTierPricing {
  annualCents: number
  monthlyCents: number | null
  isFree: boolean
}

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY
  return key ? new Stripe(key, { apiVersion: '2026-05-27.dahlia' }) : null
}

/** A Stripe price's unit amount in minor units (cents), or null on any failure. */
async function amountFromStripe(stripe: Stripe | null, id: string | null): Promise<number | null> {
  if (!stripe || !id) return null
  try {
    const p = await stripe.prices.retrieve(id)
    return typeof p.unit_amount === 'number' ? p.unit_amount : null
  } catch {
    return null
  }
}

/**
 * Every tier's resolved price, keyed by tier name. Stripe is the source of
 * truth; the membership_tiers cents columns are the fallback. Cached across
 * requests (revalidate 300s) and tagged so a Stripe edit can bust it instantly.
 */
export const getResolvedTierPricing = unstable_cache(
  async (): Promise<Record<string, ResolvedTierPricing>> => {
    const db = supabaseServer()
    const { data } = await db
      .from('membership_tiers')
      .select('name, is_free, annual_cost_cents, monthly_cost_cents, stripe_price_id, stripe_price_id_monthly')

    const stripe = stripeClient()
    const rows = (data ?? []) as Array<{
      name: string
      is_free: boolean
      annual_cost_cents: number | null
      monthly_cost_cents: number | null
      stripe_price_id: string | null
      stripe_price_id_monthly: string | null
    }>

    const out: Record<string, ResolvedTierPricing> = {}
    await Promise.all(
      rows.map(async (r) => {
        if (r.is_free) {
          out[r.name] = { annualCents: 0, monthlyCents: null, isFree: true }
          return
        }
        const [annual, monthly] = await Promise.all([
          amountFromStripe(stripe, r.stripe_price_id),
          amountFromStripe(stripe, r.stripe_price_id_monthly),
        ])
        out[r.name] = {
          annualCents: annual ?? r.annual_cost_cents ?? 0,
          monthlyCents: monthly ?? r.monthly_cost_cents ?? null,
          isFree: false,
        }
      }),
    )
    return out
  },
  ['membership-tier-pricing'],
  { revalidate: 60, tags: [MEMBERSHIP_PRICES_TAG] },
)

/** name → price for every tier. Use with formatTierPrice() for display. */
export async function getTierPriceMap(): Promise<TierPriceMap> {
  const resolved = await getResolvedTierPricing()
  const out: TierPriceMap = {}
  for (const [name, p] of Object.entries(resolved)) {
    out[name] = { name, annualCostCents: p.annualCents, isFree: p.isFree }
  }
  return out
}

/** "$59" / "$1,000" from a tier's price; "Free" when free or zero-cost. */
export function formatTierPrice(price: TierPrice | undefined): string {
  if (!price || price.isFree || price.annualCostCents === 0) return 'Free'
  return '$' + Math.round(price.annualCostCents / 100).toLocaleString('en-US')
}
