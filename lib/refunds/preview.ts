import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import { stripeClient } from '@/lib/stripe'
import { resolvePolicy, applicableTier, computeRefundOptions, daysOut, type RefundOptions } from './policy'
import { stripeRefundState, isFullyRefunded, remainingCents } from './stripe-state'

export interface RefundPreview {
  paid: boolean
  paidCents: number
  currency: string
  daysOut: number | null
  options: RefundOptions
  hasPaymentRef: boolean // false => cash refund would need manual handling
  alreadyRefunded: boolean
  /**
   * A refund made in the Stripe dashboard, outside the app. When `full`, no
   * cash/credit is offered and the delete records it; when partial, the
   * options are already capped at what is left on the charge.
   */
  externalRefund: { refundedCents: number; currency: string; full: boolean } | null
}

// Read-only computation of what a participant deletion would refund, for the
// admin delete dialog. Mirrors executeRefund's resolution without mutating.
export async function previewRefund(participantId: string): Promise<RefundPreview> {
  const db = supabaseServer()
  const empty: RefundPreview = { paid: false, paidCents: 0, currency: 'usd', daysOut: null, options: {}, hasPaymentRef: false, alreadyRefunded: false, externalRefund: null }

  const { data: p } = await db
    .from('participants')
    .select('id, registration_id, individual_payment_status, stripe_payment_intent_id')
    .eq('id', participantId)
    .maybeSingle()
  if (!p) return empty

  const { data: reg } = await db
    .from('registrations')
    .select('event_slug, status, stripe_payment_intent_id')
    .eq('id', p.registration_id)
    .maybeSingle()
  if (!reg) return empty

  const { data: prior } = await db
    .from('event_refunds')
    .select('id')
    .eq('participant_id', participantId)
    .in('refund_type', ['cash', 'credit'])
    .limit(1)
  // limit(1), not maybeSingle(): two or more rows made maybeSingle() error and
  // the participant read as "not refunded".
  const alreadyRefunded = !!prior && prior.length > 0

  // Only hard payment evidence counts: a webhook-recorded per-participant
  // payment or a stored payment_intent. registrations.status='confirmed' is NOT
  // proof of payment (test data / manual edits can confirm without money moving),
  // and treating it as such produced phantom refund offers.
  const paymentIntent = p.stripe_payment_intent_id ?? (reg.stripe_payment_intent_id as string | null)
  const paid = p.individual_payment_status === 'paid' || !!paymentIntent
  if (!paid) return { ...empty, alreadyRefunded }

  const event = await getEventBySlug(reg.event_slug as string) as { date?: string; stripePriceId?: string } | null
  const stripe = stripeClient()
  let paidCents = 0
  let currency = 'usd'
  if (event?.stripePriceId && stripe) {
    try {
      const price = await stripe.prices.retrieve(event.stripePriceId)
      paidCents = price.unit_amount ?? 0
      currency = price.currency ?? 'usd'
    } catch {
      /* leave 0 */
    }
  }
  if (paidCents <= 0 || !event?.date) {
    return { paid: true, paidCents: 0, currency, daysOut: null, options: {}, hasPaymentRef: !!paymentIntent, alreadyRefunded, externalRefund: null }
  }

  // Ask Stripe directly: a refund made in the dashboard never reaches our tables.
  const stripeState = paymentIntent && !alreadyRefunded ? await stripeRefundState(paymentIntent) : null
  const externalRefund = stripeState && stripeState.refundedCents > 0
    ? { refundedCents: stripeState.refundedCents, currency: stripeState.currency, full: isFullyRefunded(stripeState) }
    : null
  const left = remainingCents(stripeState)
  const refundBasis = left === null ? paidCents : Math.min(paidCents, left)

  const tiers = await resolvePolicy(reg.event_slug as string)
  const tier = applicableTier(tiers, event.date)
  return {
    paid: true,
    paidCents,
    currency,
    daysOut: daysOut(event.date),
    options: externalRefund?.full || alreadyRefunded ? {} : computeRefundOptions(tier, refundBasis),
    hasPaymentRef: !!paymentIntent,
    alreadyRefunded,
    externalRefund,
  }
}
