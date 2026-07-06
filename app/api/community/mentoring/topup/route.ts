import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getCurrentMember } from '@/lib/community'
import { supabaseServer } from '@/lib/supabase'
import { CREDIT_PACK_PRICE_CENTS } from '@/lib/mentoring-format'
import { getAcademyDiscountPercent, discountCents } from '@/lib/academy-discount'
import { ensureStripeCustomer } from '@/lib/stripe-customer'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

// Buy extra mentoring SESSION credits (top-up beyond the tier allowance). Mentoring
// is accounted per session — a cohort enrollment draws its planned 4/6/8 sessions
// from the ledger (migration 106) — so `quantity` is a number of sessions. The
// Stripe webhook (type 'mentoring_topup') grants a purchased cohort_access lot of
// `quantity` on success (grantPurchasedLot), which enrollment then draws FIFO
// alongside the tier allowance (migration 122). Mirrors /api/community/coaching/topup.
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const quantity = Math.max(1, Math.min(20, Math.floor(Number(body?.quantity) || 1)))

  const stripe = getStripe()
  if (!stripe) return NextResponse.json({ error: 'Payments not configured' }, { status: 503 })

  const unit0 = Number(process.env.MENTORING_CREDIT_PRICE_CENTS) || CREDIT_PACK_PRICE_CENTS
  const unit = discountCents(unit0, await getAcademyDiscountPercent(member.activeTierIds))

  const db = supabaseServer()
  const { data: m } = await db.from('members').select('email, stripe_customer_id').eq('id', member.id).maybeSingle()
  const buyer = m as { email: string | null; stripe_customer_id: string | null } | null
  const customerId = await ensureStripeCustomer(
    stripe, db,
    { id: member.id, email: buyer?.email ?? null, stripe_customer_id: buyer?.stripe_customer_id ?? null },
  )

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
  const checkout = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        quantity,
        price_data: {
          currency: 'usd',
          unit_amount: unit,
          product_data: { name: 'Mentoring session' },
        },
      },
    ],
    customer: customerId,
    success_url: `${baseUrl}/community/mentoring/discover?topup=1`,
    cancel_url: `${baseUrl}/community/mentoring/discover`,
    metadata: { type: 'mentoring_topup', memberId: member.id, quantity: String(quantity) },
    payment_intent_data: { metadata: { type: 'mentoring_topup', memberId: member.id, quantity: String(quantity) } },
  })

  return NextResponse.json({ url: checkout.url })
}
