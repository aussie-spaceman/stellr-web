import { stripeClient } from '@/lib/stripe'

export interface StripeRefundState {
  /** What the charge took, in minor units. */
  amountCents: number
  /** How much of it Stripe has already given back — by the app or by hand. */
  refundedCents: number
  currency: string
}

// Asks Stripe what has already been refunded on a payment. The app's own
// event_refunds table can't answer this: a refund made in the Stripe dashboard
// never reaches it unless the charge.refunded webhook is wired up.
//
// A read, so deliberately not gated by assertLiveCredentials (see execute.ts).
// Returns null when there is no Stripe client or the lookup fails — callers
// then fall back to what the database knows.
export async function stripeRefundState(paymentIntentId: string): Promise<StripeRefundState | null> {
  const stripe = stripeClient()
  if (!stripe) return null
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] })
    const charge = pi.latest_charge
    if (!charge || typeof charge === 'string') {
      return { amountCents: pi.amount_received ?? 0, refundedCents: 0, currency: pi.currency }
    }
    return { amountCents: charge.amount, refundedCents: charge.amount_refunded ?? 0, currency: charge.currency }
  } catch (e) {
    console.error('[refunds] Stripe refund lookup failed:', e instanceof Error ? e.message : e)
    return null
  }
}

/** Fully refunded: nothing left on the charge to give back. */
export function isFullyRefunded(s: StripeRefundState | null): boolean {
  return !!s && s.amountCents > 0 && s.refundedCents >= s.amountCents
}

/** What is still refundable on the charge, or null when Stripe couldn't say. */
export function remainingCents(s: StripeRefundState | null): number | null {
  return s ? Math.max(0, s.amountCents - s.refundedCents) : null
}
