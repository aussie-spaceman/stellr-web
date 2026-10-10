import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { sendEmail, individualConfirmationEmail } from '@/lib/email'
import { finalizeRedemption } from '@/lib/refunds/redeem'
import { recordExternalChargeRefunds } from '@/lib/refunds/stripe-webhook'
import { logActivity } from '@/lib/activity-log'
import { handleStoreOrderPaid } from '@/lib/store/orders'
import { finalizeRegistrationMerch } from '@/lib/store/event-merch'
import { fireTierPurchased, grantTier } from '@/lib/membership-grants'
import { rosterAfterPaidBooking } from '@/lib/mentoring'
import { scheduleFromRequest } from '@/lib/coaching-requests'
import { confirmPaidBooking, redeemCoupon, grantTierAllocations, grantPurchasedLot, getOfferingTarget } from '@/lib/entitlements'
import { requireStripe } from '@/lib/stripe'
import { confirmRegistration } from '@/lib/registration-confirm'
import { notifyCommunityAdmins } from '@/lib/notify'

// Formats a Stripe minor-unit amount as " ($60.00)" for activity-log summaries.
function fmtMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null) return ''
  try {
    return ` (${(amount / 100).toLocaleString('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase() })})`
  } catch {
    return ''
  }
}

// ── Event registration helpers ────────────────────────────────────────────────

// Stores the Stripe payment_intent so a later deletion can issue a cash refund.
// Per-participant payments land on the participant row; whole-group/individual
// payments land on the registration.
async function capturePaymentIntent(
  session: Stripe.Checkout.Session,
  target: { registrationId: string; participantEmail?: string }
) {
  const intent = typeof session.payment_intent === 'string' ? session.payment_intent : null
  if (!intent) return
  const db = supabaseServer()
  if (target.participantEmail) {
    await db
      .from('participants')
      .update({ stripe_payment_intent_id: intent })
      .eq('registration_id', target.registrationId)
      .eq('email', target.participantEmail)
  } else {
    await db
      .from('registrations')
      .update({ stripe_payment_intent_id: intent })
      .eq('id', target.registrationId)
  }
}

// Persist the Stripe customer created at checkout onto the matching member row
// (by email) so invoices/receipts surface in /account?tab=billing, which lists
// them via members.stripe_customer_id. Non-fatal.
async function persistStripeCustomer(session: Stripe.Checkout.Session) {
  const customerId = typeof session.customer === 'string' ? session.customer : null
  const email = session.customer_details?.email ?? session.customer_email ?? null
  if (!customerId || !email) return
  const db = supabaseServer()
  await db
    .from('members')
    .update({ stripe_customer_id: customerId })
    .eq('email', email)
    .is('stripe_customer_id', null)
}

// Logs a billing 'payment_received' against the member behind an event-registration
// payment. When participantEmail is given it targets that participant; otherwise it
// uses the registration's sole linked participant (individual registrations).
async function logEventPayment(
  session: Stripe.Checkout.Session,
  registrationId: string,
  participantEmail?: string,
) {
  const db = supabaseServer()
  let q = db
    .from('participants')
    .select('member_id')
    .eq('registration_id', registrationId)
    .not('member_id', 'is', null)
  if (participantEmail) q = q.eq('email', participantEmail)
  const { data } = await q.limit(1).maybeSingle()
  const memberId = (data as { member_id?: string | null } | null)?.member_id
  if (!memberId) return
  await logActivity({
    memberId,
    category: 'billing',
    action: 'payment_received',
    summary: `Event registration payment received${fmtMoney(session.amount_total, session.currency)}`,
    metadata: { kind: 'event', registrationId, amount: session.amount_total, currency: session.currency },
    actorType: 'stripe',
  }, db)
}

async function markIndividualPayment(registrationId: string, participantEmail: string) {
  const db = supabaseServer()

  // Mark this participant as paid
  await db
    .from('participants')
    .update({ individual_payment_status: 'paid' })
    .eq('registration_id', registrationId)
    .eq('email', participantEmail)

  // Send payment confirmation to the participant
  const { data: participant } = await db
    .from('participants')
    .select('first_name, last_name, email, membership_id')
    .eq('registration_id', registrationId)
    .eq('email', participantEmail)
    .maybeSingle()

  const { data: reg } = await db
    .from('registrations')
    .select('event_title')
    .eq('id', registrationId)
    .maybeSingle()

  if (participant && reg) {
    const p = participant as { first_name: string; last_name: string; email: string; membership_id: string }
    const r = reg as { event_title: string }
    const emailContent = individualConfirmationEmail({
      firstName: p.first_name,
      lastName: p.last_name,
      membershipId: p.membership_id,
      eventTitle: r.event_title,
      registrationId,
    })
    await sendEmail({ to: p.email, ...emailContent })
  }

  // If all participants in this registration have now settled, confirm the
  // registration. "Settled" is paid OR waived (free event) — anything else,
  // INCLUDING a null status, is outstanding. Matching only 'pending' meant a
  // participant whose row never got a status (added via the Google Sheet or the
  // organiser's manual add, both of which skipped the payment step entirely) was
  // counted as settled, and the group was confirmed while they still owed.
  const { data: unsettled } = await db
    .from('participants')
    .select('id')
    .eq('registration_id', registrationId)
    .or('individual_payment_status.is.null,individual_payment_status.eq.pending')

  if (!unsettled || unsettled.length === 0) {
    await db
      .from('registrations')
      .update({ status: 'confirmed' })
      .eq('id', registrationId)
    // Whole group now paid → finalize event merch (idempotent, non-fatal).
    await finalizeRegistrationMerch(db, registrationId)
  }
}

// ── Membership helpers ────────────────────────────────────────────────────────

async function activateMembership(
  memberId: string,
  tierId: string,
  billingInterval: string,
  stripeSubscriptionId: string,
) {
  const db = supabaseServer()

  // Deactivate any existing active membership for this member
  await db
    .from('member_memberships')
    .update({ renewal_status: 'expired' })
    .eq('member_id', memberId)
    .eq('renewal_status', 'active')

  const startedAt = new Date().toISOString().split('T')[0]
  const expiresAt = billingInterval === 'monthly'
    ? new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    : new Date(Date.now() + 366 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const { data: inserted } = await db.from('member_memberships').insert({
    member_id: memberId,
    tier_id: tierId,
    started_at: startedAt,
    expires_at: expiresAt,
    renewal_status: 'active',
    is_complimentary: false,
    source: 'stripe',
    stripe_subscription_id: stripeSubscriptionId,
    billing_interval: billingInterval,
  }).select('id').single()

  // Audit trail — paid membership activated via Stripe (this path bypasses grantTier).
  const { data: tier } = await db.from('membership_tiers').select('name').eq('id', tierId).maybeSingle()
  await logActivity({
    memberId,
    category: 'membership',
    action: 'tier_granted',
    summary: `Activated ${tier?.name ?? 'paid'} membership (${billingInterval})`,
    metadata: { tierId, tierName: tier?.name ?? null, source: 'stripe', stripeSubscriptionId, billingInterval, expiresAt },
    actorType: 'stripe',
  }, db)

  // Fan-out grant rules keyed off acquiring a tier — e.g. an educator buying
  // Innovator/Trailblazer upgrades the students they registered to Pathfinder.
  await fireTierPurchased(memberId, tierId, db)

  // ADDITIVE (entitlements ledger): materialise this tier's free coaching/mentoring
  // allocations into the new ledger, idempotent on the membership id. Non-fatal —
  // runs alongside the existing session_credits grant until the cutover.
  try {
    const membershipId = (inserted as { id?: string } | null)?.id
    if (membershipId) await grantTierAllocations(membershipId)
  } catch (err) {
    console.error('[stripe/webhook] grantTierAllocations (non-fatal):', err)
  }
}

// One-time membership bought via an emailed Stripe invoice (no subscription).
// Granted only once the invoice is paid; 12-month term, then it simply expires
// (no auto-renew — that's the card/subscription path). Mirrors activateMembership's
// fan-out + allocation steps via grantTier so the two payment paths behave alike.
async function activateInvoiceMembership(invoice: Stripe.Invoice) {
  const memberId = invoice.metadata?.memberId
  const tierId = invoice.metadata?.tierId
  if (!memberId || !tierId) {
    console.error('[stripe/webhook] membership_invoice paid but missing memberId/tierId metadata')
    return
  }
  const db = supabaseServer()
  const result = await grantTier(
    { memberId, tierId, months: 12, source: 'stripe', replacesFree: true },
    db,
  )
  // Fan-out grant rules + entitlement allocations, same as a card purchase.
  await fireTierPurchased(memberId, tierId, db)
  try {
    if (result.membershipId) await grantTierAllocations(result.membershipId)
  } catch (err) {
    console.error('[stripe/webhook] grantTierAllocations (invoice, non-fatal):', err)
  }
}

async function expireMembership(stripeSubscriptionId: string) {
  const db = supabaseServer()

  // Resolve the affected members before the update so we can log the cancellation.
  const { data: affected } = await db
    .from('member_memberships')
    .select('member_id, membership_tiers(name)')
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .eq('renewal_status', 'active')

  await db
    .from('member_memberships')
    .update({ renewal_status: 'expired', expires_at: new Date().toISOString().split('T')[0] })
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .eq('renewal_status', 'active')

  for (const row of affected ?? []) {
    const tier = Array.isArray(row.membership_tiers) ? row.membership_tiers[0] : row.membership_tiers
    await logActivity({
      memberId: row.member_id as string,
      category: 'membership',
      action: 'membership_canceled',
      summary: `${(tier as { name?: string } | null)?.name ?? 'Paid'} membership canceled (subscription ended)`,
      metadata: { stripeSubscriptionId },
      actorType: 'stripe',
    }, db)
  }
}

// deep review PAY-3: resolve the subscription id from an invoice across Stripe
// API shapes. On the pinned version (2026-05-27.dahlia) Invoice no longer carries
// a top-level `subscription`; it moved under `parent.subscription_details`
// (and per-line `parent.subscription_item_details`). Keeping the old top-level
// field as a fallback means a webhook endpoint still on a pre-basil version also
// works. Each slot may be a string id or an expanded object with `.id`.
function resolveInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const loose = invoice as unknown as {
    parent?: { subscription_details?: { subscription?: string | { id?: string } | null } | null } | null
    subscription?: string | { id?: string } | null
    lines?: {
      data?: Array<{
        parent?: { subscription_item_details?: { subscription?: string | { id?: string } | null } | null } | null
      }>
    }
  }
  const candidates: (string | { id?: string } | null | undefined)[] = [
    loose.parent?.subscription_details?.subscription,
    loose.subscription,
    ...(loose.lines?.data ?? []).map((l) => l?.parent?.subscription_item_details?.subscription),
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c) return c
    if (c && typeof c === 'object' && typeof c.id === 'string' && c.id) return c.id
  }
  return null
}

// deep review PAY-4: a registration can end up with two live Checkout sessions
// at once — the student is redirected to one while the parent is emailed the pay
// link (a second session). Both can complete. Before confirming, if the
// registration already recorded a DIFFERENT payment intent, the first payment
// already landed: refund THIS (duplicate) intent and alert admins instead of
// overwriting the first intent — overwriting would hide the original charge from
// every later refund path (cancellation, scholarship). Returns true when it
// handled a duplicate (caller must then skip confirm + capture).
async function refundDuplicateRegistrationPayment(
  session: Stripe.Checkout.Session,
  registrationId: string,
  stripe: Stripe,
): Promise<boolean> {
  const newIntent = typeof session.payment_intent === 'string' ? session.payment_intent : null
  if (!newIntent) return false
  const db = supabaseServer()
  const { data } = await db
    .from('registrations')
    .select('stripe_payment_intent_id')
    .eq('id', registrationId)
    .maybeSingle()
  const existingIntent =
    (data as { stripe_payment_intent_id?: string | null } | null)?.stripe_payment_intent_id ?? null
  // First payment, or a redelivery of the same intent → normal path. (A redelivery
  // of the very same event is already stopped by the idempotency guard upstream.)
  if (!existingIntent || existingIntent === newIntent) return false

  // Fail safe on the money: refund the duplicate, keep the first intent of record.
  await stripe.refunds.create(
    {
      payment_intent: newIntent,
      metadata: { source: 'stellr_app', reason: 'duplicate_registration_payment', registrationId },
    },
    { idempotencyKey: `dup-${session.id}` },
  )
  await notifyCommunityAdmins({
    type: 'action',
    body: `Registration ${registrationId} was paid twice. The first payment (intent ${existingIntent}) stands; the duplicate (${newIntent}) was refunded automatically. No action needed unless the family disputes it.`,
  }).catch(() => {})
  return true
}

// ── Webhook handler ───────────────────────────────────────────────────────────

// Fulfils a completed Checkout session (registration / membership / booking /
// store). Extracted so checkout.session.completed and the delayed-payment
// checkout.session.async_payment_succeeded share one body — see PAY-6 below.
async function fulfilCheckoutSession(session: Stripe.Checkout.Session, stripe: Stripe) {
  if (session.metadata?.type === 'membership') {
    // Membership purchase
    const { memberId, tierId, billingInterval } = session.metadata
    const subscriptionId = session.subscription as string

    if (memberId && tierId && subscriptionId) {
      await activateMembership(memberId, tierId, billingInterval ?? 'annual', subscriptionId)
      await logActivity({
        memberId,
        category: 'billing',
        action: 'payment_received',
        summary: `Membership payment received${fmtMoney(session.amount_total, session.currency)}`,
        metadata: { kind: 'membership', tierId, amount: session.amount_total, currency: session.currency },
        actorType: 'stripe',
      })
    }
  } else if (session.metadata?.type === 'mentoring_topup') {
    // Purchased extra mentoring credits (top-up pack) → purchased cohort_access
    // lot (one lot of N), idempotent on the Stripe session.
    const { memberId } = session.metadata
    const qty = Math.max(1, Math.floor(Number(session.metadata?.quantity) || 1))
    if (memberId) await grantPurchasedLot(memberId, 'cohort_access', qty, session.id)
  } else if (session.metadata?.type === 'coaching_topup') {
    // Purchased extra coaching sessions (top-up pack) → purchased coaching_session
    // lot (one lot of N), idempotent on the Stripe session.
    const { memberId } = session.metadata
    const qty = Math.max(1, Math.floor(Number(session.metadata?.quantity) || 1))
    if (memberId) await grantPurchasedLot(memberId, 'coaching_session', qty, session.id)
  } else if (session.metadata?.type === 'coaching_request_pay') {
    // Member-initiated coaching request, paid path: grant the purchased
    // coaching_session lot (idempotent on the Stripe session), then complete the
    // booking from the matched request. The DB is the source of truth, so the
    // session is scheduled even if the member closed the tab. scheduleFromRequest
    // is itself idempotent (an already-scheduled request returns its session).
    const { memberId, requestId, start } = session.metadata
    if (memberId && requestId && start) {
      await grantPurchasedLot(memberId, 'coaching_session', 1, session.id)
      await scheduleFromRequest(requestId, start)
    }
  } else if (session.metadata?.type === 'entitlement_booking') {
    // À-la-carte coaching/mentoring/training booking via the entitlements
    // ledger. Records the purchased (refundable) entitlement + reserves the
    // seat. If the cohort filled between checkout and webhook, refund + stop.
    const { memberId, offeringId, participantId, coupon } = session.metadata
    const creditApplied = Math.max(0, Math.floor(Number(session.metadata?.creditAppliedCents) || 0))
    const amount = session.amount_total ?? 0
    if (memberId && offeringId) {
      const intent = typeof session.payment_intent === 'string' ? session.payment_intent : null
      try {
        const bookingId = await confirmPaidBooking({
          memberId,
          offeringId,
          stripePaymentId: intent ?? session.id,
          amountChargedCents: amount,
          creditAppliedCents: creditApplied,
          participantId: participantId ?? null,
        })
        // Mentoring-cohort bookings also need the cohort_members roster (which
        // grants portal access) — confirmPaidBooking only records the ledger seat.
        const target = await getOfferingTarget(offeringId)
        if (target?.type === 'mentoring_cohort' && target.cohortId) {
          await rosterAfterPaidBooking(target.cohortId, memberId)
        }
        if (coupon) await redeemCoupon(coupon, memberId, bookingId, amount)
        await persistStripeCustomer(session)
        await logActivity({
          memberId,
          category: 'billing',
          action: 'payment_received',
          summary: `Booking payment received${fmtMoney(session.amount_total, session.currency)}`,
          metadata: { kind: 'entitlement_booking', offeringId, amount, currency: session.currency },
          actorType: 'stripe',
        })
      } catch (err) {
        console.error('[stripe/webhook] entitlement_booking confirm failed, refunding:', err)
        if (intent) await stripe.refunds.create({ payment_intent: intent })
      }
    }
  } else if (
    session.metadata?.type === 'workshop_enrollment' ||
    session.metadata?.type === 'workshop_topup'
  ) {
    // Legacy group-"Workshops" was merged into Coaching (25-Jun-2026) and its
    // enroll/top-up handlers were removed. A Stripe Checkout session created
    // before this deploy can still complete afterwards — don't silently
    // swallow the payment. Flag it loudly + in the member activity log so it
    // can be remediated by hand (grant a coaching credit or issue a refund).
    const { memberId } = session.metadata
    console.error('[stripe/webhook] stray legacy workshop payment after merge:', {
      type: session.metadata.type,
      memberId,
      workshopId: session.metadata?.workshopId ?? null,
      quantity: session.metadata?.quantity ?? null,
      sessionId: session.id,
      amount: session.amount_total,
    })
    if (memberId) {
      await persistStripeCustomer(session)
      await logActivity({
        memberId,
        category: 'billing',
        action: 'payment_received',
        summary: `Legacy workshop payment received${fmtMoney(session.amount_total, session.currency)} — needs manual remediation (Workshops merged into Coaching)`,
        metadata: {
          kind: 'legacy_workshop_stray',
          stripeType: session.metadata.type,
          workshopId: session.metadata?.workshopId ?? null,
          quantity: session.metadata?.quantity ?? null,
          sessionId: session.id,
          amount: session.amount_total,
          currency: session.currency,
        },
        actorType: 'stripe',
      })
    }
  } else if (session.metadata?.type === 'store_order') {
    // Web-store purchase (direct-to-consumer) — mark paid, place the Printful
    // order, log to activity history, email the buyer. Idempotent.
    await handleStoreOrderPaid(session)
  } else if (session.metadata?.isIndividualGroupPayment === 'true') {
    // Individual member payment within a group registration
    const { registrationId, participantEmail } = session.metadata
    if (registrationId && participantEmail) {
      await markIndividualPayment(registrationId, participantEmail)
      await capturePaymentIntent(session, { registrationId, participantEmail })
      await persistStripeCustomer(session)
      await logEventPayment(session, registrationId, participantEmail)
    }
  } else {
    // Event registration purchase (whole group or individual)
    const registrationId = session.metadata?.registrationId ?? session.client_reference_id
    const isGroup = session.metadata?.isGroup === 'true'
    if (registrationId) {
      // PAY-4: if this registration was already paid under a different intent,
      // refund this duplicate and keep the first — don't re-confirm or overwrite.
      if (!(await refundDuplicateRegistrationPayment(session, registrationId, stripe))) {
        await confirmRegistration(registrationId, isGroup)
        await capturePaymentIntent(session, { registrationId })
        await persistStripeCustomer(session)
        if (!isGroup) await logEventPayment(session, registrationId)
      }
    }
  }

  // Settle any account-credit redemption applied to this checkout.
  await finalizeRedemption(session)
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const sig = req.headers.get('stripe-signature')
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!sig || !webhookSecret) {
    return NextResponse.json({ error: 'Missing webhook signature or secret' }, { status: 400 })
  }

  const stripe = requireStripe()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
  } catch (err) {
    console.error('[stripe/webhook] Signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // ── Idempotency guard ─────────────────────────────────────────────────────
  // Stripe delivers at-least-once. Skip any event we've already fully processed
  // so a redelivery can't re-activate a membership or re-send emails. We record
  // the id only AFTER successful handling below (record-after-success), so an
  // event that erred and 500'd is still retried rather than silently dropped.
  // (Residual: two truly-concurrent deliveries of the same event could both pass
  // this read; the per-handler idempotency — grantPurchasedLot, merch — covers
  // that far-rarer case. Sequential redelivery-after-success is the reported bug.)
  {
    const seenDb = supabaseServer()
    const { data: seen } = await seenDb
      .from('stripe_webhook_events')
      .select('id')
      .eq('id', event.id)
      .maybeSingle()
    if (seen) return NextResponse.json({ ok: true, duplicate: true })
  }

  try {
    // ── checkout.session.completed / async_payment_succeeded ────────────────
    // deep review PAY-6: only fulfil once funds are actually captured. A delayed
    // method (ACH/us_bank_account, SEPA, …) completes Checkout with
    // payment_status 'unpaid'/'pending' — the money isn't ours yet, so we wait
    // for the later async_payment_succeeded (same handler). 'no_payment_required'
    // is a genuine $0 / fully-coupon session. Fulfilling an 'unpaid' session was
    // confirming registrations/memberships and placing Printful orders for money
    // that had not cleared (and might bounce).
    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      const session = event.data.object as Stripe.Checkout.Session
      if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
        await fulfilCheckoutSession(session, stripe)
      }
    }

    // ── checkout.session.async_payment_failed ───────────────────────────────
    // deep review PAY-6: a delayed payment that bounced. Nothing was fulfilled
    // (we gated on payment_status above), so just alert admins to follow up.
    if (event.type === 'checkout.session.async_payment_failed') {
      const session = event.data.object as Stripe.Checkout.Session
      await notifyCommunityAdmins({
        type: 'action',
        body: `A delayed payment failed for Checkout session ${session.id} (${session.metadata?.type ?? 'event registration'}). Nothing was confirmed or shipped; the payer may need to try another method.`,
      }).catch(() => {})
    }

    // ── invoice.paid (recurring renewal) ───────────────────────────────────
    if (event.type === 'invoice.paid') {
      const invoice = event.data.object as Stripe.Invoice
      // deep review PAY-3: resolve the subscription id across API shapes (the
      // pinned dahlia version dropped the top-level invoice.subscription).
      const subscriptionId = resolveInvoiceSubscriptionId(invoice)

      if (invoice.metadata?.type === 'membership_invoice') {
        // One-time membership purchased by emailed invoice — grant on payment.
        await activateInvoiceMembership(invoice)
      } else if (invoice.metadata?.type === 'membership' || subscriptionId) {
        // Membership renewal — extend expires_at to the period this invoice paid
        // for. Reading invoice.subscription here (the old shape) found nothing on
        // dahlia, so renewals silently never extended and paying members lost
        // their tier at day 31 / 366.
        if (subscriptionId) {
          const db = supabaseServer()
          const { data: membership } = await db
            .from('member_memberships')
            .select('id, billing_interval')
            .eq('stripe_subscription_id', subscriptionId)
            .eq('renewal_status', 'active')
            .maybeSingle()

          if (membership) {
            const interval = (membership as { billing_interval: string }).billing_interval
            // Prefer the period the invoice actually paid for; fall back to
            // now()+interval when the line period is absent.
            const periodEnd = (invoice.lines?.data?.[0] as { period?: { end?: number } } | undefined)?.period?.end
            const fallback = interval === 'monthly'
              ? new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
              : new Date(Date.now() + 366 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
            const newExpiry = periodEnd
              ? new Date(periodEnd * 1000).toISOString().split('T')[0]
              : fallback

            await db
              .from('member_memberships')
              .update({ expires_at: newExpiry })
              .eq('id', (membership as { id: string }).id)
          }
        }
      } else {
        // Event registration invoice — settled online. Mark paid AND stamp
        // invoice_paid_at (this is the invoice path, so it is required).
        const registrationId = invoice.metadata?.registrationId
        const isGroup = invoice.metadata?.isGroup === 'true'
        if (registrationId) {
          await confirmRegistration(registrationId, isGroup, { paidViaInvoice: true })
        }
      }
    }

    // ── customer.subscription.deleted (cancellation) ────────────────────────
    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as Stripe.Subscription
      await expireMembership(subscription.id)
    }

    // ── charge.refunded (incl. refunds made in the Stripe dashboard) ─────────
    // Records dashboard refunds against the event registration they paid for,
    // so a later delete doesn't refund the same money again. Charges that
    // aren't event registrations are ignored.
    if (event.type === 'charge.refunded') {
      const charge = event.data.object as Stripe.Charge
      const res = await recordExternalChargeRefunds(supabaseServer(), stripe, charge)
      if (res.recorded > 0) console.log(`[stripe/webhook] recorded ${res.recorded} external refund(s) for ${charge.id}`)
    }
  } catch (err) {
    console.error('[stripe/webhook] Handler error:', err)
    // Do NOT record the event as processed — returning 500 asks Stripe to retry,
    // and the idempotency guard above must let that retry through.
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }

  // Handled successfully — record so any redelivery is skipped. Non-fatal: if this
  // write fails the worst case is a future redelivery re-processing the event.
  try {
    await supabaseServer()
      .from('stripe_webhook_events')
      .insert({ id: event.id, type: event.type })
  } catch (e) {
    console.error('[stripe/webhook] failed to record processed event id:', e)
  }

  return NextResponse.json({ ok: true })
}
