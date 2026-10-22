import { revalidateTag } from 'next/cache'

// The Stripe prices public pages show are cached for an hour (lib/tier-pricing,
// lib/event-pricing): any shorter and their ISR pages re-render every minute.
// So that a price change in Stripe still reaches the site at once, the Stripe
// webhook calls revalidatePriceCaches() on the events below.

/** Tier prices: homepage, /membership, /competitions, /grant, /join. */
export const MEMBERSHIP_PRICES_TAG = 'membership-prices'
/** Event fees: event pages, /competitions, group registration. */
export const EVENT_PRICES_TAG = 'event-prices'

/**
 * Stripe events that can change a price the site shows: a new price (the next
 * one for a tier or event), an edit or archive (an inactive price is hidden),
 * a deletion, and a product's default price moving. Checkout's inline
 * price_data can raise price events too; refreshing on those is harmless, as
 * it only marks the cache stale for the next visit.
 */
export const PRICE_CHANGE_EVENTS: ReadonlySet<string> = new Set([
  'price.created',
  'price.updated',
  'price.deleted',
  'product.updated',
])

/** Drop both price caches, and the pages built from them, now. */
export function revalidatePriceCaches(): void {
  revalidateTag(MEMBERSHIP_PRICES_TAG, { expire: 0 })
  revalidateTag(EVENT_PRICES_TAG, { expire: 0 })
}
