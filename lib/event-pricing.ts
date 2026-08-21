import { unstable_cache } from 'next/cache'
import Stripe from 'stripe'

// ─── Live event registration pricing (single source of truth) ────────────────
//
// The per-participant fee is stored ONLY as a Stripe price ID on the Sanity
// event (`stripePriceId`) — there is no cents column anywhere. Public surfaces
// that show the fee read through this helper so the number on the page is the
// number Stripe charges at checkout, exactly as `tier-pricing.ts` does for
// membership. Never hard-code an event fee.
//
// The three-way result matters: a blank price ID genuinely means "free" (the
// registration form skips payment entirely — see the group/individual routes),
// whereas a price ID we can't resolve means the event is misconfigured. Those
// two must never render the same way: claiming "Free" for an event that is
// meant to be paid is a public pricing error we'd be honouring at checkout.
// Unresolvable prices render nothing at all and log for the operator.
//
// An INACTIVE Stripe price counts as unresolvable, not as a price. Stripe
// rejects inactive prices as checkout line items, so an amount we could read
// off one is an amount nobody can actually be charged — showing it would put a
// number on the page that no registration can ever match.
//
// Cached for 60s and tagged, so a Stripe price edit reaches the site within a
// minute of the page's own ISR window (`revalidate = 3600`) turning over.
// Server-only.

/** Cache tag for resolved event pricing (for optional on-demand revalidation). */
export const EVENT_PRICES_TAG = 'event-prices'

export type EventPrice =
  /** No Stripe price ID on the event — registration is free. */
  | { kind: 'free' }
  /** An active, one-off Stripe price resolved to this many cents. */
  | { kind: 'priced'; cents: number; currency: string }
  /** Price ID present but missing, inactive, or unreadable — show nothing. */
  | { kind: 'unavailable' }

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY
  return key ? new Stripe(key, { apiVersion: '2026-05-27.dahlia' }) : null
}

/**
 * Resolve one event's per-participant fee from Stripe. Cached per price ID so a
 * listing of many events costs one Stripe call each, not one per render.
 */
const resolvePrice = unstable_cache(
  async (priceId: string): Promise<EventPrice> => {
    const stripe = stripeClient()
    // No Stripe key configured (preview/CI): the event IS priced, we just can't
    // read it. Fail closed rather than advertising it as free.
    if (!stripe) return { kind: 'unavailable' }
    try {
      const price = await stripe.prices.retrieve(priceId)
      if (!price.active) {
        console.warn('[event-pricing] price is inactive, hiding fee —', priceId)
        return { kind: 'unavailable' }
      }
      if (typeof price.unit_amount !== 'number') {
        console.warn('[event-pricing] price has no unit_amount, hiding fee —', priceId)
        return { kind: 'unavailable' }
      }
      return { kind: 'priced', cents: price.unit_amount, currency: price.currency }
    } catch (e) {
      console.warn('[event-pricing] could not retrieve price, hiding fee —', priceId, '—', e)
      return { kind: 'unavailable' }
    }
  },
  ['event-registration-pricing'],
  { revalidate: 60, tags: [EVENT_PRICES_TAG] },
)

/** The per-participant fee for an event, from its Sanity `stripePriceId`. */
export async function getEventPrice(stripePriceId?: string | null): Promise<EventPrice> {
  if (!stripePriceId) return { kind: 'free' }
  return resolvePrice(stripePriceId)
}

/**
 * "$135" / "$1,250" / "$135.50" — whole dollars stay whole, cents only appear
 * when the price actually has them.
 */
export function formatEventPrice(cents: number, currency = 'usd'): string {
  const symbol = currency.toLowerCase() === 'usd' ? '$' : `${currency.toUpperCase()} `
  const hasCents = cents % 100 !== 0
  return (
    symbol +
    (cents / 100).toLocaleString('en-US', {
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: hasCents ? 2 : 0,
    })
  )
}

/**
 * The fee as one display string: "$135 per participant", "Free to enter", or
 * null when it can't be shown. Callers render nothing for null.
 */
export function eventPriceLabel(price: EventPrice): string | null {
  if (price.kind === 'free') return 'Free to enter'
  if (price.kind === 'priced') return `${formatEventPrice(price.cents, price.currency)} per participant`
  return null
}
