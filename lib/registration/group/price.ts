import { NextResponse } from 'next/server'
import { collectsNothing } from '@/lib/event-pricing'
import { stripeClient } from '@/lib/stripe'
import { refuse, temporarilyUnavailable, type Refusable } from '../refusal'
import { GROUP_PAYMENT_METHODS, invoiceSeatsFor, type GroupBody } from './parse'

/** What this registration owes, as far as the gate could tell. */
export interface GroupPrice {
  amountDueCents: number
  /** null = no price was read: none on the event, Stripe off, or a campaign's lookup failed. */
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
  event: { stripePriceId?: string; activityType?: string } | null,
  body: Pick<GroupBody, 'event_slug' | 'payment_method' | 'total_participants'> &
    Partial<Pick<GroupBody, 'registrant_on_invoice' | 'late_joiner_payer' | 'details_method' | 'additional_adults' | 'students' | 'share_estimate' | 'student_count'>>,
): Promise<Refusable<{ price: GroupPrice }>> {
  const { event_slug, total_participants } = body
  // Only the ways the form offers. Anything else used to fall through as a
  // card registration with no checkout.
  if (body.payment_method != null && !(GROUP_PAYMENT_METHODS as readonly unknown[]).includes(body.payment_method)) {
    return refuse(NextResponse.json({ error: 'Choose how the group will pay.' }, { status: 400 }))
  }
  // "Invoice for some" is an invoice for the ticked places; the rest pay by link.
  const invoiceSome = body.payment_method === 'invoice_some'
  const payment_method = invoiceSome ? 'invoice' : body.payment_method
  const billedSeats = invoiceSome
    ? invoiceSeatsFor({ details_method: 'add_now', ...body } as Parameters<typeof invoiceSeatsFor>[0])
    : total_participants ?? 0
  // "Students share the teacher's cost": a sensible estimate, and students to share it.
  if (body.payment_method === 'teacher_share') {
    const estimate = body.share_estimate
    if (!Number.isInteger(estimate) || (estimate as number) < 1 || (estimate as number) > 200) {
      return refuse(NextResponse.json({ error: 'Say how many students you expect to bring (1 to 200).' }, { status: 400 }))
    }
    if ((body.student_count ?? 0) < 1) {
      return refuse(NextResponse.json({ error: 'Sharing the teacher’s cost needs at least one student.' }, { status: 400 }))
    }
  }
  // "Invoice for some" always has someone on the invoice.
  if (invoiceSome && billedSeats <= 0) {
    return refuse(NextResponse.json(
      { error: 'Tick at least one person for the invoice, or choose "Group members will pay individually".' },
      { status: 400 },
    ))
  }

  // Amount owed for this registration: per-seat event fee × seats, or 0 when the
  // event has no Stripe price (campaigns / free events). Drives the payment gate.
  let amountDueCents = 0
  let feeUnitAmount: number | null = null
  const feePriceId = event?.stripePriceId
  const feeStripe = stripeClient()
  if (feePriceId && feeStripe) {
    try {
      const pr = await feeStripe.prices.retrieve(feePriceId)
      feeUnitAmount = pr.unit_amount ?? 0
      amountDueCents = feeUnitAmount * billedSeats
    } catch (e) {
      console.error('[register/group] price lookup failed:', event_slug, feePriceId, e)
      // The event has a fee and we don't know it, so this registration's amount
      // can't be recorded, whichever way it pays: refuse it before anything is
      // written, and the organiser tries again. A campaign is the exception. It
      // collects nothing and the field doesn't apply to it, so a price left on its
      // document must not stop anyone entering.
      if (event?.activityType !== 'campaign') return refuse(temporarilyUnavailable())
    }
  }

  // A free event collects nothing, ever: no Stripe webhook will fire, so a
  // registration left 'pending' would sit there forever with no path to
  // 'confirmed' (campaigns already dodge this by confirming at creation).
  // Free is either no price configured at all, or an explicit $0 price object
  // — the way free events are deliberately set up.
  const nothingToCollect = collectsNothing(feePriceId, feeUnitAmount)

  // Stripe rejects any charge below its per-currency minimum (~$0.50 USD). If a
  // card registration's price × seats lands below that, the checkout session can
  // never be created — so reject up front with a clear, actionable message
  // rather than doing all the record-creation work and then blowing up on
  // the unguarded Stripe call at the very end (which orphaned the registration,
  // participants, DocuSign envelopes, sheet and emails, and 500'd the request).
  // `feeUnitAmount !== null`: this is only for an amount we positively resolved.
  // No price at all has its own refusal below.
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
  // positively-resolved zero. No price at all is the next refusal.)
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

  // Sharing the teacher's cost needs a fee to share.
  if (body.payment_method === 'teacher_share' && (!feePriceId || !feeStripe || nothingToCollect)) {
    return refuse(NextResponse.json(
      { error: 'This event has no registration fee, so there is no teacher’s cost to share. Choose another way to pay.' },
      { status: 400 },
    ))
  }

  return {
    ok: true,
    price: { amountDueCents, feeUnitAmount, canBill: !!(feePriceId && feeStripe), nothingToCollect },
  }
}
