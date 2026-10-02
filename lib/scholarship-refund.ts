import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import { getEventBySlug } from '@/lib/sanity'
import { assertLiveCredentials } from '@/lib/env-guards'
import { logActivity } from '@/lib/activity-log'
import { stripeRefundState, remainingCents } from '@/lib/refunds/stripe-state'
import { discountedCents, formatUsd } from '@/lib/scholarship-levels'

// The reimbursement for a scholarship awarded after the student had already
// registered and paid (owner, 2 Oct 2026). Plan: docs/PLAN-scholarship-offers-2026-10-02.md.
//
//   refund = event fee they actually paid − the fee at the scholarship price
//
// "Actually paid" is read from the Stripe checkout's own line item for the
// event fee, so a discount code already used at checkout (SCHOLARSHIP50, sent
// by hand before this existed) is netted off rather than refunded twice, and
// merch add-ons are left alone. The result is capped by what Stripe says is
// still refundable on the charge.
//
// Audited in event_refunds with kind='scholarship', which the cancellation
// path ignores (lib/refunds/execute.ts) — the student is still registered.
// Card refunds carry metadata.source='stellr_app' so the charge.refunded
// webhook doesn't record them again as made-in-the-dashboard.

export type ScholarshipRefundMethod = 'cash' | 'credit'

export interface ScholarshipRefundQuote {
  /**
   * refund       — money is owed back (refundCents > 0)
   * nothing_due  — they paid no more than the scholarship price (or nothing)
   * already_done — a scholarship reimbursement was already issued
   * manual       — paid, but not by a card checkout the app can refund
   * not_paid     — the registration is still pending (the checkout discounts instead)
   */
  status: 'refund' | 'nothing_due' | 'already_done' | 'manual' | 'not_paid'
  refundCents: number
  feeCents: number | null
  feePaidCents: number | null
  targetCents: number | null
  currency: string
  detail: string
}

interface RegistrationLite {
  id: string
  event_slug: string
  event_title: string
  status: string
  type: string
  invoice_requested: boolean | null
  stripe_payment_intent_id: string | null
}

async function loadRegistration(db: SupabaseClient, registrationId: string): Promise<RegistrationLite | null> {
  const { data } = await db
    .from('registrations')
    .select('id, event_slug, event_title, status, type, invoice_requested, stripe_payment_intent_id')
    .eq('id', registrationId)
    .maybeSingle()
  return (data as RegistrationLite | null) ?? null
}

/** The event-fee line the student paid, after any discount at checkout. Null when Stripe can't say. */
async function feePaidFromCheckout(stripe: Stripe, paymentIntentId: string, priceId: string): Promise<number | null> {
  try {
    const { data: sessions } = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 })
    const session = sessions[0]
    if (!session) return null
    const { data: lines } = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 })
    const fee = lines.find((l) => l.price?.id === priceId)
    return fee ? fee.amount_total : null
  } catch (e) {
    console.error('[scholarship-refund] checkout line lookup failed:', e instanceof Error ? e.message : e)
    return null
  }
}

export async function quoteScholarshipRefund(
  db: SupabaseClient,
  stripe: Stripe | null,
  registrationId: string,
  percent: number,
): Promise<ScholarshipRefundQuote> {
  const base = { refundCents: 0, feeCents: null, feePaidCents: null, targetCents: null, currency: 'usd' }
  const reg = await loadRegistration(db, registrationId)
  if (!reg) return { ...base, status: 'manual', detail: 'Registration not found' }
  if (reg.status !== 'confirmed') {
    return { ...base, status: 'not_paid', detail: 'Not paid yet — the scholarship comes off at checkout' }
  }

  const { data: prior } = await db
    .from('event_refunds')
    .select('refund_cents, refund_type')
    .eq('registration_id', registrationId)
    .eq('kind', 'scholarship')
    .in('refund_type', ['cash', 'credit'])
    .limit(1)
  const done = (prior ?? [])[0] as { refund_cents: number | null; refund_type: string } | undefined
  if (done) {
    return {
      ...base,
      status: 'already_done',
      refundCents: done.refund_cents ?? 0,
      detail: `Scholarship reimbursement already issued (${formatUsd(done.refund_cents ?? 0)} ${done.refund_type === 'credit' ? 'credit' : 'refund'})`,
    }
  }

  if (reg.invoice_requested) {
    return { ...base, status: 'manual', detail: 'Paid by invoice — reimburse the payer manually' }
  }
  const pi = reg.stripe_payment_intent_id
  if (!pi) {
    // A confirmed registration with no card payment: a $0 checkout (a 100%
    // code), a free event, or a manual confirmation. Nothing to give back.
    return { ...base, status: 'nothing_due', detail: 'No card payment on record — nothing to reimburse' }
  }
  if (!stripe) return { ...base, status: 'manual', detail: 'Stripe is not configured here' }

  const event = (await getEventBySlug(reg.event_slug).catch(() => null)) as { stripePriceId?: string } | null
  if (!event?.stripePriceId) return { ...base, status: 'manual', detail: 'The event has no Stripe price — work out the refund manually' }
  // A failed read is not a free event: say so, rather than quietly owing nothing.
  const price = await stripe.prices.retrieve(event.stripePriceId).catch(() => null)
  if (!price) return { ...base, status: 'manual', detail: 'Couldn’t read the event fee from Stripe — work out the refund manually' }
  const feeCents = price.unit_amount ?? 0
  if (feeCents <= 0) return { ...base, status: 'nothing_due', detail: 'Free event — nothing to reimburse' }
  const currency = price?.currency ?? 'usd'

  const state = await stripeRefundState(pi)
  const left = remainingCents(state)
  // Fall back to the charge (capped at one fee) when the checkout can't be read.
  const feePaid = (await feePaidFromCheckout(stripe, pi, event.stripePriceId)) ?? Math.min(feeCents, state?.amountCents ?? feeCents)
  const target = discountedCents(feeCents, percent)
  const owed = Math.max(0, feePaid - target)
  const refundCents = left === null ? owed : Math.min(owed, left)

  const quote = { refundCents, feeCents, feePaidCents: feePaid, targetCents: target, currency }
  if (refundCents <= 0) {
    return {
      ...quote,
      status: 'nothing_due',
      detail:
        owed > 0
          ? 'Already refunded in Stripe — nothing left to reimburse'
          : `They paid ${formatUsd(feePaid)}, no more than the scholarship price — nothing to reimburse`,
    }
  }
  return { ...quote, status: 'refund', detail: `Paid ${formatUsd(feePaid)} for the fee; scholarship price ${formatUsd(target)}` }
}

export interface ScholarshipRefundResult {
  type: 'cash' | 'credit' | 'manual_required' | 'none'
  refundCents: number
  detail: string
  stripeRefundId?: string
  creditId?: string
}

/**
 * Issues the reimbursement quoted above. Never throws: a failed card refund is
 * audited as manual_required and reported, and the offer itself still stands.
 */
export async function issueScholarshipRefund(
  db: SupabaseClient,
  stripe: Stripe | null,
  input: {
    applicationId: string
    registrationId: string
    percent: number
    method: ScholarshipRefundMethod
    actorMemberId: string | null
  },
): Promise<ScholarshipRefundResult> {
  const quote = await quoteScholarshipRefund(db, stripe, input.registrationId, input.percent)
  if (quote.status !== 'refund' && quote.status !== 'manual') {
    return { type: 'none', refundCents: 0, detail: quote.detail }
  }

  const reg = await loadRegistration(db, input.registrationId)
  if (!reg) return { type: 'manual_required', refundCents: 0, detail: quote.detail }
  const { data: part } = await db
    .from('participants')
    .select('id, member_id')
    .eq('registration_id', reg.id)
    .limit(1)
    .maybeSingle()
  const participant = part as { id: string; member_id: string | null } | null

  const audit = async (result: ScholarshipRefundResult, note: string | null) => {
    const { error } = await db.from('event_refunds').insert({
      participant_id: participant?.id ?? null,
      registration_id: reg.id,
      member_id: participant?.member_id ?? null,
      event_slug: reg.event_slug,
      paid_cents: quote.feePaidCents,
      refund_type: result.type,
      refund_pct: input.percent,
      refund_cents: result.refundCents,
      stripe_refund_id: result.stripeRefundId ?? null,
      account_credit_id: result.creditId ?? null,
      decided_by: input.actorMemberId,
      source: 'admin',
      kind: 'scholarship',
      note,
      currency: quote.currency,
    })
    if (error) console.error('[scholarship-refund] audit insert failed:', error.message, { registrationId: reg.id })
  }
  const amount = `${formatUsd(quote.refundCents)}`

  // Paid, but the app can't work out or move the money (invoice, no Stripe
  // price, Stripe unreachable). Record it so staff see it needs doing by hand.
  if (quote.status === 'manual') {
    const result: ScholarshipRefundResult = { type: 'manual_required', refundCents: 0, detail: quote.detail }
    await audit(result, quote.detail)
    return result
  }

  if (input.method === 'credit') {
    if (!participant?.member_id) {
      const result: ScholarshipRefundResult = { type: 'manual_required', refundCents: quote.refundCents, detail: 'No member account to hold the credit — reimburse manually' }
      await audit(result, result.detail)
      return result
    }
    // No expiry: this is the student's scholarship, not a cancellation credit.
    const { data: credit, error } = await db
      .from('account_credits')
      .insert({
        member_id: participant.member_id,
        currency: quote.currency,
        amount_cents: quote.refundCents,
        remaining_cents: quote.refundCents,
        source_type: 'scholarship',
        source_participant_id: participant.id,
        source_registration_id: reg.id,
        reason: `${input.percent}% scholarship — ${reg.event_title}`,
        expires_at: null,
      })
      .select('id')
      .single()
    if (error || !credit) {
      const result: ScholarshipRefundResult = { type: 'manual_required', refundCents: quote.refundCents, detail: `Account credit could not be issued: ${error?.message ?? 'no row returned'}` }
      await audit(result, result.detail)
      return result
    }
    const result: ScholarshipRefundResult = { type: 'credit', refundCents: quote.refundCents, creditId: (credit as { id: string }).id, detail: `${amount} account credit issued` }
    await audit(result, `${input.percent}% scholarship — ${quote.detail}`)
    await logActivity({
      memberId: participant.member_id,
      category: 'billing',
      action: 'scholarship_refund_issued',
      summary: `Scholarship reimbursement — ${amount} account credit`,
      metadata: { kind: 'credit', registrationId: reg.id, refundCents: quote.refundCents, scholarshipId: input.applicationId },
      actorType: 'admin',
      actorMemberId: input.actorMemberId,
    }, db)
    return result
  }

  const pi = reg.stripe_payment_intent_id
  if (!stripe || !pi) {
    const result: ScholarshipRefundResult = { type: 'manual_required', refundCents: quote.refundCents, detail: 'No Stripe payment reference — refund manually in Stripe' }
    await audit(result, result.detail)
    return result
  }
  try {
    // Same guard as cancellation refunds: never move money on a production
    // deployment holding test keys.
    assertLiveCredentials('stripe')
    const refund = await stripe.refunds.create(
      {
        payment_intent: pi,
        amount: quote.refundCents,
        metadata: { source: 'stellr_app', kind: 'scholarship', scholarship_id: input.applicationId, registration_id: reg.id },
      },
      // One scholarship refund per application, however many times it's retried.
      { idempotencyKey: `scholarship-refund-${input.applicationId}` },
    )
    const result: ScholarshipRefundResult = { type: 'cash', refundCents: quote.refundCents, stripeRefundId: refund.id, detail: `${amount} refunded to the card` }
    await audit(result, `${input.percent}% scholarship — ${quote.detail}`)
    if (participant?.member_id) {
      await logActivity({
        memberId: participant.member_id,
        category: 'billing',
        action: 'scholarship_refund_issued',
        summary: `Scholarship reimbursement — ${amount} refunded to the card`,
        metadata: { kind: 'cash', registrationId: reg.id, refundCents: quote.refundCents, stripeRefundId: refund.id, scholarshipId: input.applicationId },
        actorType: 'admin',
        actorMemberId: input.actorMemberId,
      }, db)
    }
    return result
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'Stripe refund failed'
    const result: ScholarshipRefundResult = { type: 'manual_required', refundCents: quote.refundCents, detail }
    await audit(result, `Scholarship refund failed — ${detail}`)
    return result
  }
}

/** The scholarship reimbursement recorded on a registration, if any — for emails and history. */
export async function scholarshipRefundFor(
  db: SupabaseClient,
  registrationId: string,
): Promise<{ type: string; refundCents: number; note: string | null } | null> {
  const { data } = await db
    .from('event_refunds')
    .select('refund_type, refund_cents, note, created_at')
    .eq('registration_id', registrationId)
    .eq('kind', 'scholarship')
    .order('created_at', { ascending: false })
    .limit(1)
  const row = (data ?? [])[0] as { refund_type: string; refund_cents: number | null; note: string | null } | undefined
  return row ? { type: row.refund_type, refundCents: row.refund_cents ?? 0, note: row.note } : null
}
