import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { sendEmail, individualConfirmationEmail, groupPaymentConfirmedEmail } from '@/lib/email'
import { finalizeRedemption } from '@/lib/refunds/redeem'
import { logActivity } from '@/lib/activity-log'
import { handleStoreOrderPaid } from '@/lib/store/orders'
import { finalizeRegistrationMerch } from '@/lib/store/event-merch'
import { fireTierPurchased, grantTier } from '@/lib/membership-grants'
import { rosterAfterPaidBooking } from '@/lib/mentoring'
import { scheduleFromRequest } from '@/lib/coaching-requests'
import { confirmPaidBooking, redeemCoupon, grantTierAllocations, grantPurchasedLot, getOfferingTarget } from '@/lib/entitlements'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY not set')
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

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

  // If all participants in this registration have now paid, confirm the registration
  const { data: stillPending } = await db
    .from('participants')
    .select('id')
    .eq('registration_id', registrationId)
    .eq('individual_payment_status', 'pending')

  if (!stillPending || stillPending.length === 0) {
    await db
      .from('registrations')
      .update({ status: 'confirmed' })
      .eq('id', registrationId)
    // Whole group now paid → finalize event merch (idempotent, non-fatal).
    await finalizeRegistrationMerch(db, registrationId)
  }
}

async function confirmRegistration(registrationId: string, isGroup: boolean) {
  const db = supabaseServer()

  await db.from('registrations').update({ status: 'confirmed' }).eq('id', registrationId)

  // Finalize event merch: allocate the included shirt to every participant
  // (sized from their t-shirt size) and activate any paid add-ons. Idempotent + non-fatal.
  await finalizeRegistrationMerch(db, registrationId)

  if (isGroup) {
    const { data: reg } = await db.from('registrations')
      .select('event_title, teacher_first_name, teacher_email')
      .eq('id', registrationId).maybeSingle()

    if (reg) {
      const r = reg as { event_title: string; teacher_first_name: string | null; teacher_email: string | null }
      if (r.teacher_email) {
        const emailContent = groupPaymentConfirmedEmail({
          teacherFirstName: r.teacher_first_name ?? 'there',
          eventTitle: r.event_title,
          registrationId,
        })
        await sendEmail({ to: r.teacher_email, ...emailContent })
      }
    }
  } else {
    const { data: participant } = await db.from('participants')
      .select('first_name, last_name, email, membership_id')
      .eq('registration_id', registrationId).maybeSingle()

    const { data: reg } = await db.from('registrations')
      .select('event_title').eq('id', registrationId).maybeSingle()

    if (participant && reg) {
      const p = participant as { first_name: string; last_name: string; email: string; membership_id: string }
      const r = reg as { event_title: string }
      const emailContent = individualConfirmationEmail({
        firstName: p.first_name, lastName: p.last_name,
        membershipId: p.membership_id, eventTitle: r.event_title,
        registrationId,
      })
      await sendEmail({ to: p.email, ...emailContent })
    }
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

// ── Webhook handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const sig = req.headers.get('stripe-signature')
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!sig || !webhookSecret) {
    return NextResponse.json({ error: 'Missing webhook signature or secret' }, { status: 400 })
  }

  const stripe = getStripe()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
  } catch (err) {
    console.error('[stripe/webhook] Signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    // ── checkout.session.completed ──────────────────────────────────────────
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session

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
      } else if (session.metadata?.type === 'extra_session') {
        // Purchased extra coaching/mentoring session → purchased ledger lot
        // (FR-COM-11/12). The booking engine draws it like any other allocation.
        const { memberId, sessionType } = session.metadata
        if (memberId && (sessionType === 'coaching' || sessionType === 'mentoring')) {
          const kind = sessionType === 'coaching' ? 'coaching_session' : 'cohort_access'
          await grantPurchasedLot(memberId, kind, 1, session.id)
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
            if (intent) await getStripe().refunds.create({ payment_intent: intent })
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
          await confirmRegistration(registrationId, isGroup)
          await capturePaymentIntent(session, { registrationId })
          await persistStripeCustomer(session)
          if (!isGroup) await logEventPayment(session, registrationId)
        }
      }

      // Settle any account-credit redemption applied to this checkout.
      await finalizeRedemption(session)
    }

    // ── invoice.paid (recurring renewal) ───────────────────────────────────
    if (event.type === 'invoice.paid') {
      const invoice = event.data.object as Stripe.Invoice & { subscription?: string | null }

      if (invoice.metadata?.type === 'membership_invoice') {
        // One-time membership purchased by emailed invoice — grant on payment.
        await activateInvoiceMembership(invoice)
      } else if (invoice.metadata?.type === 'membership' || invoice.subscription) {
        // Membership renewal — extend expires_at by the billing period
        const subscriptionId = invoice.subscription ?? null
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
            const newExpiry = interval === 'monthly'
              ? new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
              : new Date(Date.now() + 366 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

            await db
              .from('member_memberships')
              .update({ expires_at: newExpiry })
              .eq('id', (membership as { id: string }).id)
          }
        }
      } else {
        // Event registration invoice
        const registrationId = invoice.metadata?.registrationId
        const isGroup = invoice.metadata?.isGroup === 'true'
        if (registrationId) {
          await confirmRegistration(registrationId, isGroup)
        }
      }
    }

    // ── customer.subscription.deleted (cancellation) ────────────────────────
    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as Stripe.Subscription
      await expireMembership(subscription.id)
    }
  } catch (err) {
    console.error('[stripe/webhook] Handler error:', err)
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
