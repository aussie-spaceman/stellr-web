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
// The four-way result matters, and each state is a different public claim:
//
//   tbc         no price ID yet — the fee simply hasn't been set. Says so.
//   free        an explicit $0 Stripe price. Free events are configured this
//               way deliberately, so "free" is an authored decision we can
//               show (and honour at checkout) rather than an inference.
//   priced      an active price above zero.
//   unavailable a price ID that is missing or inactive in Stripe — the event is
//               misconfigured. Renders nothing and logs for the operator.
//
// Never collapse `tbc` into `free`: advertising a fee-less event as free is a
// price we'd then have to honour, and an unset fee is not a decision to charge
// nothing. `free` is also what the registration stack keys on — see
// `collectsNothing()` below.
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
  /** No Stripe price ID on the event — the fee hasn't been set yet. */
  | { kind: 'tbc' }
  /** An explicit $0 Stripe price — the event is deliberately free. */
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
      // A zero price object is how a free event is configured, and the whole
      // registration stack keys off it — so it must resolve to `free`, not to a
      // $0.00 fee nobody can be charged.
      if (price.unit_amount === 0) return { kind: 'free' }
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
  if (!stripePriceId) return { kind: 'tbc' }
  return resolvePrice(stripePriceId)
}

/**
 * Does this event collect anything at registration?
 *
 * The registration stack (group/individual routes, the group form, per-member
 * payment links) used to key "free" on a blank price ID alone. Free events are
 * now configured as an explicit $0 Stripe price, which has a price ID — so the
 * rule is the resolved AMOUNT, not the presence of an ID.
 *
 * `resolvedCents` must be null when the lookup failed, never 0: a transient
 * Stripe error is not a free event, and treating it as one would confirm
 * registrations for a fee that was never collected.
 */
export function collectsNothing(
  stripePriceId: string | null | undefined,
  resolvedCents: number | null,
): boolean {
  if (!stripePriceId) return true
  return resolvedCents === 0
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
 * The fee as one display string: "$135 per participant", "Free to enter",
 * "Pricing TBC", or null when the price is misconfigured. Callers render
 * nothing for null.
 */
export function eventPriceLabel(price: EventPrice): string | null {
  if (price.kind === 'tbc') return 'Pricing TBC'
  if (price.kind === 'free') return 'Free to enter'
  if (price.kind === 'priced') return `${formatEventPrice(price.cents, price.currency)} per participant`
  return null
}
