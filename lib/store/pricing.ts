// Unit-price computation for the web store (PRD §12).
//
// The single place that turns a variant's market price + buyer context into the
// amount charged. Storefront context applies the membership-tier discount;
// event context applies the event merch discount. The two axes never stack.
// Final amounts feed Stripe Checkout line_items via price_data, so no per-event
// Stripe Price objects are needed.

import { resolveEventPercent, resolveTierPercent } from './discounts'
import type { PriceContext, PriceResult } from './types'

export async function computeUnitPrice(
  variant: { market_price_cents: number; product_id: string },
  product: { product_type: string },
  ctx: PriceContext,
): Promise<PriceResult> {
  const base = variant.market_price_cents
  let percent = 0

  if (ctx.kind === 'storefront') {
    if (ctx.tierId) {
      percent = await resolveTierPercent(ctx.tierId, variant.product_id, product.product_type)
    }
  } else {
    percent = await resolveEventPercent(ctx.eventSlug, variant.product_id, product.product_type)
  }

  percent = Math.max(0, Math.min(100, percent))
  const unit = Math.round((base * (100 - percent)) / 100)
  return { base_cents: base, percent_off: percent, unit_cents: unit }
}
