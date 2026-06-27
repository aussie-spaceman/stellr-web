import type Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'

// ─── Academy tier discount (mentoring / coaching / training purchases) ───────────
//
// Distinct from the STORE discount (store_tier_discounts). The per-tier % lives on
// membership_tiers.academy_discount_percent (migration 100); academy checkout routes
// apply it as DYNAMIC pricing — the discounted unit_amount is computed server-side and
// passed to Stripe, so no coupons are needed. Server-only.

/** Highest academy discount % across the member's active tiers (0 when none). */
export async function getAcademyDiscountPercent(activeTierIds: string[]): Promise<number> {
  if (!activeTierIds?.length) return 0
  const db = supabaseServer()
  const { data } = await db
    .from('membership_tiers')
    .select('academy_discount_percent')
    .in('id', activeTierIds)
  return (data ?? []).reduce(
    (max, r) => Math.max(max, (r as { academy_discount_percent: number }).academy_discount_percent ?? 0),
    0,
  )
}

/** Apply a discount % to a cents amount (rounded, never below 0). */
export function discountCents(baseCents: number, percent: number): number {
  if (!percent || percent <= 0) return baseCents
  return Math.max(0, Math.round((baseCents * (100 - percent)) / 100))
}

/**
 * Build a one-off checkout line item from a FIXED Stripe price, applying the academy
 * discount via dynamic price_data. Returns the original `price` reference when the
 * discount is 0 (cheaper, keeps Stripe reporting clean).
 */
export async function academyLineItemFromPrice(
  stripe: Stripe,
  priceId: string,
  percent: number,
  fallbackName: string,
): Promise<Stripe.Checkout.SessionCreateParams.LineItem> {
  if (!percent || percent <= 0) return { price: priceId, quantity: 1 }
  const price = await stripe.prices.retrieve(priceId)
  const base = price.unit_amount ?? 0
  const productField =
    typeof price.product === 'string'
      ? { product: price.product }
      : { product_data: { name: fallbackName } }
  return {
    quantity: 1,
    price_data: {
      currency: price.currency ?? 'usd',
      unit_amount: discountCents(base, percent),
      ...productField,
    },
  }
}
