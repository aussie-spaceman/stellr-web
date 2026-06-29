import Stripe from 'stripe'
import { unstable_cache } from 'next/cache'
import { supabaseServer } from '@/lib/supabase'

// Monthly billing is offered only on the four school/college paid tiers (their
// stripe_price_id_monthly is set in migration 111; teacher tiers stay null).
// The monthly *amount* lives in Stripe (single source of truth for the price we
// charge), so read it from there and format for display. Cached for an hour.

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY
  return key ? new Stripe(key, { apiVersion: '2026-05-27.dahlia' }) : null
}

function format(cents: number): string {
  return cents % 100 === 0
    ? '$' + (cents / 100).toLocaleString('en-US')
    : '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** tier name → formatted monthly price (e.g. "Pathfinder" → "$8"). Only tiers with a monthly price. */
export const getMonthlyPriceMap = unstable_cache(
  async (): Promise<Record<string, string>> => {
    const db = supabaseServer()
    const { data } = await db
      .from('membership_tiers')
      .select('name, stripe_price_id_monthly')
      .not('stripe_price_id_monthly', 'is', null)

    const stripe = getStripe()
    const out: Record<string, string> = {}
    if (!stripe) return out
    for (const r of (data ?? []) as Array<{ name: string; stripe_price_id_monthly: string }>) {
      try {
        const price = await stripe.prices.retrieve(r.stripe_price_id_monthly)
        if (price.unit_amount != null) out[r.name] = format(price.unit_amount)
      } catch (e) {
        console.error('[membership-monthly] price retrieve failed for', r.name, e)
      }
    }
    return out
  },
  ['membership-monthly-prices'],
  { revalidate: 3600 },
)
