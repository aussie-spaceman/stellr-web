import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getCurrentMember } from '@/lib/community'
import { supabaseServer } from '@/lib/supabase'
import { getPlatformPricing } from '@/lib/pricing'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

// Buy a pack of workshop credits (top-up). The Stripe webhook (type
// 'workshop_topup') grants `quantity` available workshop credits on success.
// Unit price comes from platform_pricing (overridable via WORKSHOP_CREDIT_PRICE_CENTS).
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const quantity = Math.max(1, Math.min(20, Math.floor(Number(body?.quantity) || 1)))

  const stripe = getStripe()
  if (!stripe) return NextResponse.json({ error: 'Payments not configured' }, { status: 503 })

  const pricing = await getPlatformPricing()
  const unit = Number(process.env.WORKSHOP_CREDIT_PRICE_CENTS) || pricing.workshopCreditPriceCents

  const db = supabaseServer()
  const { data: m } = await db.from('members').select('email, stripe_customer_id').eq('id', member.id).maybeSingle()
  const buyer = m as { email: string | null; stripe_customer_id: string | null } | null

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
  const checkout = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        quantity,
        price_data: {
          currency: 'usd',
          unit_amount: unit,
          product_data: { name: 'Workshop credit' },
        },
      },
    ],
    ...(buyer?.stripe_customer_id ? { customer: buyer.stripe_customer_id } : buyer?.email ? { customer_email: buyer.email } : {}),
    success_url: `${baseUrl}/community/workshops/discover?topup=1`,
    cancel_url: `${baseUrl}/community/workshops/discover`,
    metadata: { type: 'workshop_topup', memberId: member.id, quantity: String(quantity) },
    payment_intent_data: { metadata: { type: 'workshop_topup', memberId: member.id, quantity: String(quantity) } },
  })

  return NextResponse.json({ url: checkout.url })
}
