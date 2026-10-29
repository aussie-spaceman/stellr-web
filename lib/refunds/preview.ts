import { supabaseServer } from '@/lib/supabase'
import { stripeClient } from '@/lib/stripe'
import { GUARANTEE_DAYS, daysSincePayment, guaranteeRefundOptions, type RefundOptions } from './policy'
import { stripeRefundState, isFullyRefunded, remainingCents } from './stripe-state'
import { resolveRefundBasis } from './payment-basis'

export interface RefundPreview {
  paid: boolean
  paidCents: number
  currency: string
  /** Whole days since the charge, or null when Stripe couldn't say. */
  daysSincePayment: number | null
  /** The guarantee window, for the dialog's wording. */
  guaranteeDays: number
  options: RefundOptions
  hasPaymentRef: boolean // false => cash refund would need manual handling
  alreadyRefunded: boolean
  /**
   * A refund made in the Stripe dashboard, outside the app. When `full`, no
   * refund is offered and the delete records it; when partial, the
   * options are already capped at what is left on the charge.
   */
  externalRefund: { refundedCents: number; currency: string; full: boolean } | null
}

// Read-only computation of what a participant deletion would refund, for the
// admin delete dialog. Mirrors executeRefund's resolution without mutating.
export async function previewRefund(participantId: string): Promise<RefundPreview> {
  const db = supabaseServer()
  const empty: RefundPreview = { paid: false, paidCents: 0, currency: 'usd', daysSincePayment: null, guaranteeDays: GUARANTEE_DAYS, options: {}, hasPaymentRef: false, alreadyRefunded: false, externalRefund: null }

  const { data: p } = await db
    .from('participants')
    .select('id, registration_id, individual_payment_status, stripe_payment_intent_id')
    .eq('id', participantId)
    .maybeSingle()
  if (!p) return empty

  const { data: prior } = await db
    .from('event_refunds')
    .select('id')
    .eq('participant_id', participantId)
    .in('refund_type', ['cash', 'credit'])
    // A scholarship reimbursement is not a cancellation refund: the student is
    // still registered, and cancelling later still owes the guarantee refund on
    // what remains (Stripe's remaining-refundable cap applies below).
    .eq('kind', 'cancellation')
    .limit(1)
  // limit(1), not maybeSingle(): two or more rows made maybeSingle() error and
  // the participant read as "not refunded".
  const alreadyRefunded = !!prior && prior.length > 0

  // Same resolution as executeRefund: which payment covered this place, and
  // what the place actually cost after any discount (lib/refunds/payment-basis.ts).
  const stripe = stripeClient()
  const basis = await resolveRefundBasis(db, stripe, p)
  if (!basis) return empty
  const paymentIntent = basis.paymentIntent
  if (!basis.paid) return { ...empty, alreadyRefunded }

  const paidCents = basis.perPlaceCents
  const currency = basis.currency
  if (paidCents <= 0) {
    return { ...empty, paid: true, currency, hasPaymentRef: !!paymentIntent, alreadyRefunded }
  }

  // Ask Stripe directly: a refund made in the dashboard never reaches our tables.
  const stripeState = paymentIntent && !alreadyRefunded ? await stripeRefundState(paymentIntent) : null
  const externalRefund = stripeState && stripeState.refundedCents > 0
    ? { refundedCents: stripeState.refundedCents, currency: stripeState.currency, full: isFullyRefunded(stripeState) }
    : null
  const left = remainingCents(stripeState)
  const refundBasis = left === null ? paidCents : Math.min(paidCents, left)

  // The guarantee runs from the charge's date, which only Stripe knows: with no
  // answer from Stripe nothing is offered, and the dialog says why.
  const paidAt = stripeState?.paidAt ?? null
  return {
    paid: true,
    paidCents,
    currency,
    daysSincePayment: paidAt ? daysSincePayment(paidAt) : null,
    guaranteeDays: GUARANTEE_DAYS,
    options: externalRefund?.full || alreadyRefunded ? {} : guaranteeRefundOptions(paidAt, refundBasis),
    hasPaymentRef: !!paymentIntent,
    alreadyRefunded,
    externalRefund,
  }
}
