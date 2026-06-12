import Stripe from 'stripe'

// Shared Stripe client. Mirrors the inline `new Stripe(key, { apiVersion:
// '2026-05-27.dahlia' })` used across the register/webhook routes. Returns null
// when Stripe isn't configured so callers can degrade gracefully.
export function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}
