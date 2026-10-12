import { randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'

// Account-credit redemption. Credits issued on registration deletion can be
// applied to a future Stripe Checkout. We allocate credit at checkout-creation
// time (building a one-time coupon) and finalize the ledger in the webhook once
// the payment actually completes.
//
// deep review PAY-9: allocation now RESERVES the credit atomically — it decrements
// account_credits.remaining_cents under a compare-and-swap and records the hold in
// credit_redemptions(status='reserved'). Previously a coupon was minted for the
// full balance with no reservation, and settlement clamped at zero
// (remaining = max(0, remaining - amount)), so two concurrent checkouts could each
// carry the full credit and spend it twice while the ledger hid the overspend. With
// a reservation, the second checkout sees the reduced balance and cannot re-spend
// it. A reservation whose checkout is abandoned lapses and is released back to the
// credit on the member's next checkout attempt (lazy, no cron).

interface CreditRow {
  id: string
  remaining_cents: number
  currency: string
}

export interface CreditAllocation {
  creditId: string
  amount: number
}

export interface CreditDiscount {
  couponId: string
  appliedCents: number
  allocations: CreditAllocation[]
  /** Groups this checkout's reserved credit rows; carried in session metadata so
   *  the webhook settles exactly these holds. */
  reservationId: string
}

// Hold a reservation a little past the Stripe Checkout session lifetime (~24h) so
// a session completing right at the edge still settles against a live hold.
const RESERVATION_TTL_MS = 26 * 60 * 60 * 1000

async function usableCredits(db: SupabaseClient, memberId: string, currency: string): Promise<CreditRow[]> {
  // Return any lapsed-but-unsettled reservations to the balance first, so an
  // abandoned earlier checkout doesn't strand this member's own credit.
  await releaseLapsedReservations(db, memberId)
  const nowIso = new Date().toISOString()
  const { data } = await db
    .from('account_credits')
    .select('id, remaining_cents, currency, expires_at, status')
    .eq('member_id', memberId)
    .eq('currency', currency)
    .in('status', ['available', 'partially_redeemed'])
    .gt('remaining_cents', 0)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('expires_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
  return (data ?? []) as CreditRow[]
}

// Builds a one-time Stripe coupon covering up to `grossCents` of the member's
// available credit (FIFO by expiry) AND reserves that credit so it cannot be
// spent by a second concurrent checkout. Returns null when no credit applies. The
// reservation is settled (or released) by the webhook on completion (or lapse).
export async function buildCreditDiscount(
  stripe: Stripe,
  memberId: string,
  currency: string,
  grossCents: number
): Promise<CreditDiscount | null> {
  if (grossCents <= 0) return null
  const db = supabaseServer()
  const credits = await usableCredits(db, memberId, currency)

  const reservationId = randomBytes(16).toString('hex')
  const reservedExpiry = new Date(Date.now() + RESERVATION_TTL_MS).toISOString()

  let remaining = grossCents
  const allocations: CreditAllocation[] = []
  for (const c of credits) {
    if (remaining <= 0) break
    const take = await reserveFromCredit(db, c.id, memberId, Math.min(c.remaining_cents, remaining), reservationId, reservedExpiry)
    if (take > 0) {
      allocations.push({ creditId: c.id, amount: take })
      remaining -= take
    }
  }
  const appliedCents = allocations.reduce((s, a) => s + a.amount, 0)
  if (appliedCents <= 0) return null

  const coupon = await stripe.coupons.create({
    amount_off: appliedCents,
    currency,
    duration: 'once',
    name: 'Account credit',
  })
  return { couponId: coupon.id, appliedCents, allocations, reservationId }
}

// Atomically reserve up to `want` cents from one credit. CAS-decrements
// remaining_cents (so two concurrent reservations of the same credit cannot both
// succeed) and records the hold. Returns the amount actually reserved (0 if the
// credit was exhausted or the hold couldn't be recorded). Retries on a lost CAS,
// re-reading the now-smaller balance each time.
async function reserveFromCredit(
  db: SupabaseClient,
  creditId: string,
  memberId: string,
  want: number,
  reservationId: string,
  reservedExpiry: string,
): Promise<number> {
  for (let attempt = 0; attempt < 3 && want > 0; attempt++) {
    const { data: credit } = await db
      .from('account_credits')
      .select('remaining_cents')
      .eq('id', creditId)
      .maybeSingle()
    const remaining = (credit as { remaining_cents?: number } | null)?.remaining_cents
    if (remaining == null || remaining <= 0) return 0
    const take = Math.min(remaining, want)
    const next = remaining - take
    // CAS: only decrement if remaining is unchanged since we read it.
    const { data: updated } = await db
      .from('account_credits')
      .update({ remaining_cents: next, status: next === 0 ? 'redeemed' : 'partially_redeemed' })
      .eq('id', creditId)
      .eq('remaining_cents', remaining)
      .select('id')
      .maybeSingle()
    if (!updated) continue // another checkout reserved first — re-read and retry.

    const { error: holdError } = await db.from('credit_redemptions').insert({
      credit_id: creditId,
      member_id: memberId,
      amount_cents: take,
      status: 'reserved',
      reservation_id: reservationId,
      reserved_expires_at: reservedExpiry,
      stripe_checkout_session_id: null,
      applied_to: null,
    })
    if (holdError) {
      // Couldn't record the hold: give the money back rather than leave an
      // untracked decrement that can never be settled or released (fail closed).
      await restoreCredit(db, creditId, take)
      return 0
    }
    return take
  }
  return 0
}

// Return `amount` cents to a credit (CAS add-back), capped so remaining never
// exceeds the credit's original amount, and reopen its status.
async function restoreCredit(db: SupabaseClient, creditId: string, amount: number): Promise<void> {
  const { data: credit } = await db
    .from('account_credits')
    .select('remaining_cents, amount_cents')
    .eq('id', creditId)
    .maybeSingle()
  if (!credit) return
  const remaining = (credit as { remaining_cents: number }).remaining_cents
  const cap = (credit as { amount_cents?: number }).amount_cents ?? remaining + amount
  const restored = Math.min(cap, remaining + amount)
  await db
    .from('account_credits')
    .update({ remaining_cents: restored, status: restored >= cap ? 'available' : 'partially_redeemed' })
    .eq('id', creditId)
    .eq('remaining_cents', remaining)
}

// Release this member's reservations whose checkout never completed. Flips the
// hold to 'released' under a status guard (so a concurrent sweep can't release it
// twice) and returns the held amount to the credit.
async function releaseLapsedReservations(db: SupabaseClient, memberId: string): Promise<void> {
  const nowIso = new Date().toISOString()
  const { data: lapsed } = await db
    .from('credit_redemptions')
    .select('id, credit_id, amount_cents')
    .eq('member_id', memberId)
    .eq('status', 'reserved')
    .lt('reserved_expires_at', nowIso)
  for (const r of (lapsed ?? []) as { id: string; credit_id: string; amount_cents: number }[]) {
    const { data: flipped } = await db
      .from('credit_redemptions')
      .update({ status: 'released' })
      .eq('id', r.id)
      .eq('status', 'reserved')
      .select('id')
      .maybeSingle()
    if (!flipped) continue // already released by a concurrent sweep.
    await restoreCredit(db, r.credit_id, r.amount_cents)
  }
}

// Settles credit redemption after a checkout completes. Idempotent per reservation.
export async function finalizeRedemption(session: Stripe.Checkout.Session): Promise<void> {
  const reservationId = session.metadata?.creditReservationId
  const memberId = session.metadata?.creditMemberId

  if (reservationId && memberId) {
    // Reservation path (deep review PAY-9): the balance was already decremented at
    // reservation time, so settlement only flips the holds reserved→settled and
    // stamps the session. The status guard makes a webhook redelivery a no-op.
    const db = supabaseServer()
    await db
      .from('credit_redemptions')
      .update({
        status: 'settled',
        stripe_checkout_session_id: session.id,
        applied_to: session.metadata?.registrationId ?? session.metadata?.type ?? null,
      })
      .eq('reservation_id', reservationId)
      .eq('status', 'reserved')
    return
  }

  // Back-compat: a session minted before the reservation change carries
  // creditAllocations and no reservation id. Settle it the old way — decrement,
  // flip status, record — idempotent per (credit, session).
  const raw = session.metadata?.creditAllocations
  if (!raw || !memberId) return

  let allocations: CreditAllocation[]
  try {
    allocations = JSON.parse(raw)
  } catch {
    return
  }

  const db = supabaseServer()
  for (const alloc of allocations) {
    const { data: existing } = await db
      .from('credit_redemptions')
      .select('id')
      .eq('credit_id', alloc.creditId)
      .eq('stripe_checkout_session_id', session.id)
      .maybeSingle()
    if (existing) continue

    const { data: credit } = await db
      .from('account_credits')
      .select('remaining_cents')
      .eq('id', alloc.creditId)
      .maybeSingle()
    if (!credit) continue

    const remaining = Math.max(0, (credit.remaining_cents as number) - alloc.amount)
    await db
      .from('account_credits')
      .update({ remaining_cents: remaining, status: remaining === 0 ? 'redeemed' : 'partially_redeemed' })
      .eq('id', alloc.creditId)

    await db.from('credit_redemptions').insert({
      credit_id: alloc.creditId,
      member_id: memberId,
      amount_cents: alloc.amount,
      status: 'settled',
      stripe_checkout_session_id: session.id,
      applied_to: session.metadata?.registrationId ?? session.metadata?.type ?? null,
    })
  }
}
