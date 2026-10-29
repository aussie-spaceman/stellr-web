import type Stripe from 'stripe'
import type { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import { currentSeatsInvoice, invoicePaymentIntent, loadRegistration, perSeatPaidCents } from '@/lib/group-billing'

type Db = ReturnType<typeof supabaseServer>

// What one participant's place actually cost, and which payment to refund it
// from (29 Oct 2026). Before this the refund basis was the event's list price
// (deep review 12.2), so a discounted place could be refunded more than it
// took, and a group that paid its invoice had no stored payment at all: the
// invoice.paid webhook never kept the payment intent.
//
//   per-person payment (own checkout, or an "additional places" invoice)
//                     → the participant's payment intent
//   whole-group or individual registration payment
//                     → the registration's payment intent; for an invoiced
//                       group, the paid invoice's (looked up and stored once)
//
// The per-place amount is what the payment charged per place: a paid group
// invoice's total over its places, a Checkout fee line's total over its
// quantity, else the list price. Stripe's remaining-refundable cap still
// applies on top (lib/refunds/stripe-state.ts).

export interface RefundBasis {
  paymentIntent: string | null
  /** True when there is proof of payment, even if Stripe can't refund it (e.g. a cheque). */
  paid: boolean
  /** What one place cost, before Stripe's remaining-refundable cap. 0 = unknown/free. */
  perPlaceCents: number
  currency: string
  /** Set when the place was paid by a Stripe invoice, to attach a credit note. */
  stripeInvoiceId: string | null
  /** Who paid: the participant themselves, or the group's organiser. */
  payer: 'self' | 'organiser'
}

interface ParticipantFacts {
  id: string
  registration_id: string
  individual_payment_status: string | null
  stripe_payment_intent_id: string | null
}

export async function resolveRefundBasis(db: Db, stripe: Stripe | null, p: ParticipantFacts): Promise<RefundBasis | null> {
  const reg = await loadRegistration(db as never, p.registration_id)
  if (!reg) return null
  const { data: extra } = await db.from('registrations').select('checkout_session_id').eq('id', p.registration_id).maybeSingle()
  const checkoutSessionId = (extra as { checkout_session_id?: string | null } | null)?.checkout_session_id ?? null

  let paymentIntent = p.stripe_payment_intent_id ?? reg.stripe_payment_intent_id ?? null
  const fromParticipant = !!p.stripe_payment_intent_id
  const invoicedAndPaid = !!reg.invoice_requested && !!reg.invoice_paid_at

  // An invoiced group whose payment was never stored: ask Stripe once, keep it.
  if (!paymentIntent && invoicedAndPaid && stripe) {
    try {
      const current = await currentSeatsInvoice(db as never, stripe, reg)
      if (current?.invoice.status === 'paid') {
        paymentIntent = await invoicePaymentIntent(stripe, current.invoice.id as string)
        if (paymentIntent) {
          await db.from('group_invoices').update({ payment_intent_id: paymentIntent }).eq('stripe_invoice_id', current.invoice.id as string)
          await db.from('registrations').update({ stripe_payment_intent_id: paymentIntent }).eq('id', reg.id)
        }
      }
    } catch (e) {
      console.error('[refunds] group invoice payment lookup failed:', e instanceof Error ? e.message : e)
    }
  }

  // Only hard payment evidence counts (registrations.status='confirmed' never
  // did): a per-person payment, a stored intent, or an invoice marked paid.
  const paid = p.individual_payment_status === 'paid' || !!paymentIntent || invoicedAndPaid
  const payer: RefundBasis['payer'] = reg.type === 'group' && !reg.member_pays_individually ? 'organiser' : 'self'
  if (!paid) return { paymentIntent: null, paid: false, perPlaceCents: 0, currency: 'usd', stripeInvoiceId: null, payer }

  // Paid by a group invoice (the main one or an "additional places" one)?
  if (paymentIntent) {
    const { data: rows } = await db
      .from('group_invoices')
      .select('stripe_invoice_id, total_cents, seats, currency, kind')
      .eq('payment_intent_id', paymentIntent)
      .limit(1)
    const row = (rows as { stripe_invoice_id: string; total_cents: number; seats: number; currency: string }[] | null)?.[0]
    const perPlace = row ? perSeatPaidCents(row.total_cents, row.seats) : null
    if (row && perPlace) {
      return { paymentIntent, paid, perPlaceCents: perPlace, currency: row.currency, stripeInvoiceId: row.stripe_invoice_id, payer: 'organiser' }
    }
  }

  const listPrice = await eventListPrice(stripe, reg.event_slug)

  // Paid through Checkout: the fee line's own total, discounts included.
  if (paymentIntent && !fromParticipant && checkoutSessionId && stripe && listPrice?.priceId) {
    try {
      const items = await stripe.checkout.sessions.listLineItems(checkoutSessionId, { limit: 50 })
      const fee = items.data.find((li) => li.price?.id === listPrice.priceId)
      if (fee && (fee.quantity ?? 0) > 0) {
        const perPlace = Math.floor((fee.amount_total ?? 0) / (fee.quantity as number))
        if (perPlace > 0) return { paymentIntent, paid, perPlaceCents: perPlace, currency: fee.currency, stripeInvoiceId: null, payer }
      }
    } catch (e) {
      console.error('[refunds] checkout line lookup failed:', e instanceof Error ? e.message : e)
    }
  }

  return {
    paymentIntent,
    paid,
    perPlaceCents: listPrice?.unitCents ?? 0,
    currency: listPrice?.currency ?? 'usd',
    stripeInvoiceId: null,
    payer: fromParticipant ? 'self' : payer,
  }
}

async function eventListPrice(stripe: Stripe | null, eventSlug: string): Promise<{ priceId: string; unitCents: number; currency: string } | null> {
  const event = (await getEventBySlug(eventSlug)) as { stripePriceId?: string } | null
  if (!event?.stripePriceId || !stripe) return null
  try {
    const price = await stripe.prices.retrieve(event.stripePriceId)
    return { priceId: event.stripePriceId, unitCents: price.unit_amount ?? 0, currency: price.currency ?? 'usd' }
  } catch {
    return null
  }
}
