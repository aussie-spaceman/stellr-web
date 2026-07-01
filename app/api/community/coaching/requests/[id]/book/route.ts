import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getCurrentMember } from '@/lib/community'
import { supabaseServer } from '@/lib/supabase'
import { getRequestById, scheduleFromRequest } from '@/lib/coaching-requests'
import { getAcademyDiscountPercent, discountCents } from '@/lib/academy-discount'
import { ensureStripeCustomer } from '@/lib/stripe-customer'

const SESSION_PRICE_CENTS = Number(process.env.COACHING_SESSION_PRICE_CENTS) || 4000

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

// Book (schedule) a matched coaching request at a chosen time. Included/award
// eligibility draws the member's allocation and books immediately; paid eligibility
// (or an exhausted allowance) routes through Stripe, and the webhook grants the
// purchased lot and completes the booking — so the DB is the source of truth even
// if the member closes the tab.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const start = typeof body?.start === 'string' ? body.start : ''
  const when = new Date(start)
  if (!start || Number.isNaN(when.getTime())) return NextResponse.json({ error: 'Pick a valid date and time.' }, { status: 400 })
  if (when.getTime() < Date.now()) return NextResponse.json({ error: 'Please choose a time in the future.' }, { status: 400 })

  const request = await getRequestById(id)
  if (!request || request.memberId !== member.id) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (request.status === 'scheduled') return NextResponse.json({ ok: true, redirect: `/community/coaching/request/${id}` })
  if (request.status !== 'matched') return NextResponse.json({ error: 'This request is not ready to book.' }, { status: 400 })

  // Free paths (included / award): draw the allocation and book now.
  if (request.eligibility !== 'paid') {
    const result = await scheduleFromRequest(id, start)
    if (result.ok) return NextResponse.json({ ok: true, redirect: `/community/coaching/request/${id}` })
    // Allowance exhausted → fall through to payment rather than dead-ending.
    if (!result.needsPurchase) return NextResponse.json({ error: result.error ?? 'Could not book.' }, { status: 400 })
  }

  // Paid path → Stripe Checkout. The webhook (type coaching_request_pay) grants the
  // purchased lot and completes the booking.
  const stripe = getStripe()
  if (!stripe) return NextResponse.json({ error: 'Payments not configured' }, { status: 503 })

  const db = supabaseServer()
  const { data: m } = await db.from('members').select('email, stripe_customer_id').eq('id', member.id).maybeSingle()
  const buyer = m as { email: string | null; stripe_customer_id: string | null } | null
  const customerId = await ensureStripeCustomer(stripe, db, {
    id: member.id,
    email: buyer?.email ?? null,
    stripe_customer_id: buyer?.stripe_customer_id ?? null,
  })

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
  const unitNet = discountCents(SESSION_PRICE_CENTS, await getAcademyDiscountPercent(member.activeTierIds))
  const meta = { type: 'coaching_request_pay', memberId: member.id, requestId: id, start }

  const checkout = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        quantity: 1,
        price_data: { currency: 'usd', unit_amount: unitNet, product_data: { name: 'Coaching session' } },
      },
    ],
    customer: customerId,
    success_url: `${baseUrl}/community/coaching/request/${id}?booked=1`,
    cancel_url: `${baseUrl}/community/coaching/request/${id}/book`,
    metadata: meta,
    payment_intent_data: { metadata: meta },
  })

  return NextResponse.json({ url: checkout.url })
}
