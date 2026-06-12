import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import { stripeClient } from './stripe'
import { resolvePolicy, applicableTier, computeRefundOptions, daysOut, type RefundOptions } from './policy'

export interface RefundPreview {
  paid: boolean
  paidCents: number
  currency: string
  daysOut: number | null
  options: RefundOptions
  hasPaymentRef: boolean // false => cash refund would need manual handling
  alreadyRefunded: boolean
}

// Read-only computation of what a participant deletion would refund, for the
// admin delete dialog. Mirrors executeRefund's resolution without mutating.
export async function previewRefund(participantId: string): Promise<RefundPreview> {
  const db = supabaseServer()
  const empty: RefundPreview = { paid: false, paidCents: 0, currency: 'usd', daysOut: null, options: {}, hasPaymentRef: false, alreadyRefunded: false }

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
    .maybeSingle()
  const alreadyRefunded = !!prior

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
    return { paid: true, paidCents: 0, currency, daysOut: null, options: {}, hasPaymentRef: !!paymentIntent, alreadyRefunded }
  }

  const tiers = await resolvePolicy(reg.event_slug as string)
  const tier = applicableTier(tiers, event.date)
  return {
    paid: true,
    paidCents,
    currency,
    daysOut: daysOut(event.date),
    options: computeRefundOptions(tier, paidCents),
    hasPaymentRef: !!paymentIntent,
    alreadyRefunded,
  }
}
