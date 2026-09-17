import Stripe from 'stripe'

// The one Stripe client. Every route, lib module and script used to construct
// its own `new Stripe(key, { apiVersion })`, which meant the API version lived
// in 26 places. Two flavours, matching the two contracts callers already had:
//
//   stripeClient()  → null when STRIPE_SECRET_KEY is unset, for code that can
//                     degrade (hide a price, skip a refund preview).
//   requireStripe() → throws, for code that cannot proceed without Stripe
//                     (checkout, the webhook).

export const STRIPE_API_VERSION = '2026-05-27.dahlia' as const

export function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION })
}

export function requireStripe(): Stripe {
  const client = stripeClient()
  if (!client) throw new Error('STRIPE_SECRET_KEY not set')
  return client
}
