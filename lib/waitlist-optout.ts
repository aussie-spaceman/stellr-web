// One-click opt-out for event-waitlist mail.
//
// The existing marketing unsubscribe (lib/email-campaigns.ts → members
// .marketing_unsubscribe_token) only works for people who exist in Supabase as
// members. Waitlist contacts are HubSpot contacts: someone who asked to be told
// when registration opens has usually never created an account, so there is no
// member row and no token to look up.
//
// Rather than write a member row for every lead just to hold a token, the token
// here is *derived* from the email — an HMAC, so it is unforgeable but needs no
// storage and stays valid for any future send.
//
// CAN-SPAM requires the opt-out to work without the recipient logging in, so
// the link carries the address it refers to. That means the token has to be
// verified before it is acted on, or the endpoint becomes a way to unsubscribe
// arbitrary people.

import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Signing key. Prefers a dedicated secret; falls back to CRON_SECRET so this
 * works in every environment that already runs the scheduled jobs, rather than
 * failing closed on an env var nobody knew to set.
 */
function secret(): string | undefined {
  return process.env.MARKETING_OPTOUT_SECRET ?? process.env.CRON_SECRET
}

function normalise(email: string): string {
  return email.trim().toLowerCase()
}

/** Deterministic per-address token. Returns undefined when unconfigured. */
export function optOutToken(email: string): string | undefined {
  const key = secret()
  if (!key) return undefined
  return createHmac('sha256', key).update(normalise(email)).digest('hex').slice(0, 32)
}

/** Constant-time compare, so the endpoint can't be used as an oracle. */
export function verifyOptOutToken(email: string, token: string): boolean {
  const expected = optOutToken(email)
  if (!expected || !token || expected.length !== token.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token))
  } catch {
    return false
  }
}

/**
 * Unsubscribe link for a waitlist recipient. Distinct query keys (`wl`, `e`)
 * from the member flow's `token`, so the endpoint can tell the two apart
 * without ambiguity.
 */
export function waitlistUnsubscribeUrl(email: string): string | undefined {
  const token = optOutToken(email)
  if (!token) return undefined
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
  return `${base}/api/email/unsubscribe?wl=${token}&e=${encodeURIComponent(normalise(email))}`
}
