import type Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'

// Account-credit redemption. Credits issued on registration deletion can be
// applied to a future Stripe Checkout. We allocate credit at checkout-creation
// time (building a one-time coupon) and finalize the ledger in the webhook once
// the payment actually completes.

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
}

// Sum of usable credit for a member in a given currency.
export async function availableCreditCents(memberId: string, currency: string): Promise<number> {
  const credits = await usableCredits(memberId, currency)
  return credits.reduce((sum, c) => sum + c.remaining_cents, 0)
}

async function usableCredits(memberId: string, currency: string): Promise<CreditRow[]> {
  const db = supabaseServer()
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
// available credit (FIFO by expiry). Returns null when no credit applies. The
// returned allocations are stored in checkout metadata and settled by the
// webhook on completion — the ledger is NOT decremented here (the payment may
// never complete).
export async function buildCreditDiscount(
  stripe: Stripe,
  memberId: string,
  currency: string,
  grossCents: number
): Promise<CreditDiscount | null> {
  if (grossCents <= 0) return null
  const credits = await usableCredits(memberId, currency)

  let remaining = grossCents
  const allocations: CreditAllocation[] = []
  for (const c of credits) {
    if (remaining <= 0) break
    const take = Math.min(c.remaining_cents, remaining)
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
  return { couponId: coupon.id, appliedCents, allocations }
}

// Settles credit redemption after a checkout completes. Reads the allocations
// from session metadata, decrements each credit, flips status, and records a
// credit_redemptions row. Idempotent per (credit, session).
export async function finalizeRedemption(session: Stripe.Checkout.Session): Promise<void> {
  const raw = session.metadata?.creditAllocations
  const memberId = session.metadata?.creditMemberId
  if (!raw || !memberId) return

  let allocations: CreditAllocation[]
  try {
    allocations = JSON.parse(raw)
  } catch {
    return
  }

  const db = supabaseServer()
  for (const alloc of allocations) {
    // Skip if we've already recorded this redemption for this session.
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
      stripe_checkout_session_id: session.id,
      applied_to: session.metadata?.registrationId ?? session.metadata?.type ?? null,
    })
  }
}
