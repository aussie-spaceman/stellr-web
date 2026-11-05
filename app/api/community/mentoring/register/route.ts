import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { communityWriteBlock } from '@/lib/community'
import { getOnboardedMember } from '@/lib/onboarded-member'
import { supabaseServer } from '@/lib/supabase'
import { enrollWithCredit, enrollFree, getCohortFull, resolveCohortAccess } from '@/lib/mentoring'
import { getOrCreateCohortOffering, hasReservedCohortBooking } from '@/lib/entitlements'
import { getAcademyDiscountPercent, academyLineItemFromPrice, discountCents } from '@/lib/academy-discount'
import { ensureStripeCustomer } from '@/lib/stripe-customer'
import { assertNotImpersonating } from '@/lib/impersonation'
import { assertLiveCredentials } from '@/lib/env-guards'
import { stripeClient } from '@/lib/stripe'
import { GUARANTEE_CHECKOUT_TEXT } from '@/lib/guarantee'
import { reportEnrollmentGate, accessGatesEnforced } from '@/lib/access-gates'

// A seat this member already holds in the ledger but staff have yet to roster
// (a held paid seat). Same answer on every path, so nobody pays twice.
function bookingPending() {
  return NextResponse.json(
    { error: 'Your place in this cohort is already booked and waiting on our team. You do not need to pay again; we will be in touch.' },
    { status: 409 },
  )
}

// Self-register for an open mentoring cohort: free-with-membership, with a
// mentoring credit, or via a one-off Stripe payment.
export async function POST(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getOnboardedMember()
  if (!member) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  // Decision 24: age and guardian-consent restrictions (lib/community).
  const restricted = await communityWriteBlock(member, 'join')
  if (restricted) return restricted

  const body = await req.json().catch(() => ({}))
  const cohortId = String(body?.cohortId || '')
  const method = String(body?.method || '') as 'free' | 'credit' | 'paid'
  if (!cohortId) return NextResponse.json({ error: 'Missing cohort' }, { status: 400 })

  const cohort = await getCohortFull(cohortId)
  if (!cohort || !cohort.takesRegistrations) return NextResponse.json({ error: 'This cohort is not open for registration' }, { status: 404 })

  if (method === 'free') {
    const r = await enrollFree(member, cohortId)
    if (!r.ok && r.reason === 'booking-pending') return bookingPending()
    if (!r.ok) return NextResponse.json({ error: 'Could not join this cohort' }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  if (method === 'credit') {
    const r = await enrollWithCredit(member, cohortId)
    if (!r.ok && r.reason === 'booking-pending') return bookingPending()
    if (!r.ok) {
      const msg = r.reason === 'no-credit'
        ? 'You do not have enough session credits for this cohort'
        : 'Could not join this cohort'
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  }

  // Paid one-off → Stripe Checkout.
  const access = await resolveCohortAccess(member, cohort)
  if (access.enrolled) return NextResponse.json({ error: 'Already enrolled' }, { status: 400 })
  // Already paid (or drawn credits) for this cohort but not on the roster yet,
  // e.g. the webhook's minor-agreement backstop held the seat for staff. The
  // roster check above cannot see that booking; never charge for it twice.
  if (await hasReservedCohortBooking(member.id, cohortId)) return bookingPending()
  if (!cohort.oneOffPriceCents && !cohort.oneOffStripePriceId) {
    return NextResponse.json({ error: 'This cohort has no one-off payment option' }, { status: 400 })
  }
  // Minor participation-agreement gate, BEFORE any Checkout exists, so a minor
  // without an agreement on file is never charged for a seat they cannot take.
  // Same refusal as the free and credit paths (report-only unless
  // ACCESS_GATES_ENFORCE). The webhook re-checks at roster time as a backstop.
  const gate = await reportEnrollmentGate(member, { kind: 'cohort', containerId: cohortId, containerName: cohort.name })
  if (accessGatesEnforced() && !gate.unlocked) {
    return NextResponse.json({ error: 'Could not join this cohort' }, { status: 400 })
  }

  const stripe = stripeClient()
  if (!stripe) return NextResponse.json({ error: 'Payments not configured' }, { status: 503 })

  const db = supabaseServer()
  const { data: m } = await db
    .from('members')
    .select('email, stripe_customer_id')
    .eq('id', member.id)
    .maybeSingle()
  const buyer = m as { email: string | null; stripe_customer_id: string | null } | null
  const customerId = await ensureStripeCustomer(
    stripe, db,
    { id: member.id, email: buyer?.email ?? null, stripe_customer_id: buyer?.stripe_customer_id ?? null },
  )

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
  const academyPct = await getAcademyDiscountPercent(member.activeTierIds)
  const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = cohort.oneOffStripePriceId
    ? await academyLineItemFromPrice(stripe, cohort.oneOffStripePriceId, academyPct, `Mentoring cohort — ${cohort.name}`)
    : {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: discountCents(cohort.oneOffPriceCents!, academyPct),
          product_data: { name: `Mentoring cohort — ${cohort.name}` },
        },
      }

  // Fulfilment is unified on the entitlements ledger: the webhook's
  // entitlement_booking branch records the purchase (confirmPaidBooking) and rosters
  // the member into the cohort. Pricing stays here (academy discount above); only the
  // offering id is threaded through so the webhook knows what was bought.
  const offeringId = await getOrCreateCohortOffering(cohortId)
  if (!offeringId) return NextResponse.json({ error: 'Could not prepare this cohort for purchase' }, { status: 500 })

  const bookingMeta = {
    type: 'entitlement_booking',
    memberId: member.id,
    offeringId,
    creditAppliedCents: '0',
  }
  // deep review PAY-15: refuse to take money on a production deployment holding
  // TEST keys — a test-mode charge looks successful and settles nothing. No-op on
  // real prod (live keys). Reads/pricing above are deliberately not gated.
  assertLiveCredentials('stripe')
  const checkout = await stripe.checkout.sessions.create({
    // The money-back guarantee, on Stripe's page above the Pay button.
    custom_text: GUARANTEE_CHECKOUT_TEXT,
    mode: 'payment',
    line_items: [lineItem],
    customer: customerId,
    success_url: `${baseUrl}/community/mentoring/${cohortId}?joined=1`,
    cancel_url: `${baseUrl}/community/mentoring/discover`,
    metadata: bookingMeta,
    payment_intent_data: { metadata: bookingMeta },
  })

  return NextResponse.json({ url: checkout.url })
}
