import { NextResponse } from 'next/server'
import { collectsNothing } from '@/lib/event-pricing'
import { stripeClient } from '@/lib/stripe'
import { refuse, type Refusable } from '../refusal'
import type { GroupBody } from './parse'

/** What this registration owes, as far as the gate could tell. */
export interface GroupPrice {
  amountDueCents: number
  /** null = price never resolved (no price / lookup failed). */
  feeUnitAmount: number | null
  /** The event has a price and Stripe is configured, so seats can be billed. */
  canBill: boolean
  nothingToCollect: boolean
}

/**
 * POST /api/register/group, the amount owed and whether the chosen way to pay can
 * collect it. Every refusal here comes before any record exists.
 */
export async function priceGroupRegistration(
  event: { stripePriceId?: string } | null,
  body: Pick<GroupBody, 'event_slug' | 'payment_method' | 'total_participants'>,
): Promise<Refusable<{ price: GroupPrice }>> {
  const { event_slug, payment_method, total_participants } = body

  // Amount owed for this registration: per-seat event fee × seats, or 0 when the
  // event has no Stripe price (campaigns / free events). Drives the payment gate.
  let amountDueCents = 0
  let feeUnitAmount: number | null = null // null = price never resolved (no price / lookup failed)
  const feePriceId = event?.stripePriceId
  const feeStripe = stripeClient()
  if (feePriceId && feeStripe) {
    try {
      const pr = await feeStripe.prices.retrieve(feePriceId)
      feeUnitAmount = pr.unit_amount ?? 0
      amountDueCents = feeUnitAmount * (total_participants ?? 0)
    } catch (e) {
      console.error('[register/group] price lookup failed (amount_due defaults 0):', e)
    }
  }

  // A free event collects nothing, ever: no Stripe webhook will fire, so a
  // registration left 'pending' would sit there forever with no path to
  // 'confirmed' (campaigns already dodge this by confirming at creation).
  // Free is either no price configured at all, or an explicit $0 price object
  // — the way free events are deliberately set up. A price that exists but
  // failed to resolve also leaves amountDueCents at 0, but that is a transient
  // error, not a free event: `feeUnitAmount` stays null there, so the
  // registration correctly stays pending rather than being confirmed unpaid.
  const nothingToCollect = collectsNothing(feePriceId, feeUnitAmount)

  // Stripe rejects any charge below its per-currency minimum (~$0.50 USD). If a
  // card registration's price × seats lands below that, the checkout session can
  // never be created — so reject up front with a clear, actionable message
  // rather than doing all the record-creation work and then blowing up on
  // the unguarded Stripe call at the very end (which orphaned the registration,
  // participants, DocuSign envelopes, sheet and emails, and 500'd the request).
  // `feeUnitAmount !== null` guards against a transient price-lookup failure —
  // we only reject when we positively resolved a sub-minimum amount.
  const STRIPE_MIN_CHARGE_CENTS = 50
  if (
    payment_method === 'card' &&
    feeUnitAmount !== null &&
    amountDueCents < STRIPE_MIN_CHARGE_CENTS
  ) {
    return refuse(NextResponse.json(
      {
        error: `Card payment isn't available for this event: the total ($${(amountDueCents / 100).toFixed(2)}) is below the $0.50 minimum for card charges. This event's price appears to be misconfigured — please contact Stellr or choose the invoice option.`,
      },
      { status: 400 },
    ))
  }

  // Card chosen but the event has no Stripe price (or Stripe isn't configured):
  // the card branch in respond would silently no-op and the request would return 201
  // with checkoutUrl=null, leaving the registration stuck 'pending' forever with
  // no payment path and no error. Reject up front, before any records exist.
  if (payment_method === 'card' && (!feePriceId || !feeStripe)) {
    console.error('[register/group] card selected but no Stripe price/config for event', {
      event_slug, hasPrice: !!feePriceId, hasStripe: !!feeStripe,
    })
    return refuse(NextResponse.json(
      {
        error: 'Card payment is not set up for this event. Please choose the invoice option or contact Stellr.',
      },
      { status: 400 },
    ))
  }

  // Same up-front rejection for a $0 invoice: if the price positively resolved
  // to a non-positive total, no invoice can ever be sent, so reject BEFORE any
  // records are created. Without this the registration would be created with
  // invoice_requested=true, the invoice block in respond would skip the send, and
  // every member surface would show "Invoice sent to organiser" for an invoice
  // that never existed. (`feeUnitAmount !== null` = we only reject on a
  // positively-resolved zero; a transient lookup failure is recovered inside
  // the invoice block instead.)
  if (
    payment_method === 'invoice' &&
    feeUnitAmount !== null &&
    amountDueCents <= 0
  ) {
    return refuse(NextResponse.json(
      {
        error: `Invoice payment isn't available for this event: the total resolved to $${(amountDueCents / 100).toFixed(2)}. This event's price appears to be misconfigured — please contact Stellr.`,
      },
      { status: 400 },
    ))
  }

  // The guard above only fires on a price that positively resolved to zero. An
  // event with NO Stripe price at all (free, or a Price ID never pasted into
  // Sanity) left feeUnitAmount null and slipped straight through it: the
  // registration was created with invoice_requested=true, the invoice block
  // skipped on `stripePriceId &&`, and every member surface then reported
  // "Invoice sent to organiser" for an invoice that was never created. Same
  // up-front rejection as the card path, which already covers this case.
  // A genuinely free event never reaches here — the form hides the payment
  // question and sends 'none'.
  if (payment_method === 'invoice' && (!feePriceId || !feeStripe)) {
    console.error('[register/group] invoice selected but no Stripe price/config for event', {
      event_slug, hasPrice: !!feePriceId, hasStripe: !!feeStripe,
    })
    return refuse(NextResponse.json(
      {
        error: 'This event has no registration fee configured, so no invoice can be issued. Please refresh the page — if the event is meant to be paid, contact Stellr.',
      },
      { status: 400 },
    ))
  }

  return {
    ok: true,
    price: { amountDueCents, feeUnitAmount, canBill: !!(feePriceId && feeStripe), nothingToCollect },
  }
}
