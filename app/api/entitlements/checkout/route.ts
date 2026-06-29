import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { getQuote, confirmPaidBooking, redeemCoupon } from '@/lib/entitlements'
import { ensureStripeCustomer } from '@/lib/stripe-customer'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY not set')
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

// Create a Stripe Checkout session for an à-la-carte booking (coaching /
// mentoring / training). Price comes from the entitlements pricing engine
// (base → tier discount → coupon → account credit). The webhook's
// `entitlement_booking` branch confirms the booking + reserves the seat.
export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { offeringId?: string; coupon?: string; participantId?: string } | null
  if (!body?.offeringId) return NextResponse.json({ error: 'offeringId required' }, { status: 400 })

  const db = supabaseServer()
  const { data: member } = await db
    .from('members')
    .select('id, email, stripe_customer_id')
    .eq('clerk_user_id', userId)
    .single()
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const memberId = member.id as string
  const offering = body.offeringId
  const coupon = body.coupon ?? null

  let quote
  try {
    quote = await getQuote(memberId, offering, coupon)
  } catch (err) {
    console.error('[entitlements/checkout] quote:', err)
    return NextResponse.json({ error: 'Could not price this offering' }, { status: 500 })
  }
  if (quote.includedAvailable) {
    return NextResponse.json({ error: 'Offering is included — use the free booking endpoint' }, { status: 409 })
  }

  const creditApplied = quote.netCents - quote.payableCents // covered by account credit

  // Fully covered by credit (or free): confirm directly, no Stripe charge.
  if (quote.payableCents <= 0) {
    try {
      const bookingId = await confirmPaidBooking({
        memberId, offeringId: offering, stripePaymentId: `credit_${offering}_${Date.now()}`,
        amountChargedCents: 0, creditAppliedCents: creditApplied, participantId: body.participantId ?? null,
      })
      if (coupon && quote.couponApplied) await redeemCoupon(coupon, memberId, bookingId, 0)
      return NextResponse.json({ bookingId, paid: false })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not book'
      return NextResponse.json({ error: msg }, { status: 400 })
    }
  }

  // Fetch the offering title for the line item.
  const { data: off } = await db.schema('entitlements').from('offerings').select('title').eq('id', offering).single()
  const title = (off as { title?: string } | null)?.title ?? 'Booking'

  const stripe = getStripe()
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

  const customerId = await ensureStripeCustomer(
    stripe, db,
    { id: memberId, email: member.email as string | null, stripe_customer_id: member.stripe_customer_id as string | null },
    userId,
  )

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'payment',
    line_items: [{
      price_data: { currency: 'usd', product_data: { name: title }, unit_amount: quote.payableCents },
      quantity: 1,
    }],
    success_url: `${baseUrl}/account?booking=success`,
    cancel_url: `${baseUrl}/account`,
    metadata: {
      type: 'entitlement_booking',
      memberId,
      offeringId: offering,
      creditAppliedCents: String(creditApplied),
      ...(coupon && quote.couponApplied ? { coupon } : {}),
      ...(body.participantId ? { participantId: body.participantId } : {}),
    },
  })

  return NextResponse.json({ url: session.url })
}
