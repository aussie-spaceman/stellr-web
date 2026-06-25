import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getCurrentMember } from '@/lib/community'
import { supabaseServer } from '@/lib/supabase'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

const SESSION_PRICE_CENTS = Number(process.env.COACHING_SESSION_PRICE_CENTS) || 4000

// Buy extra coaching sessions beyond the free tier allowance. The Stripe webhook
// (type 'coaching_topup') grants `quantity` available coaching credits on success.
// The 3-pack is priced at a 10% discount (matching the Buy modal).
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const quantity = Number(body?.quantity) === 3 ? 3 : 1
  const workshopId = typeof body?.workshopId === 'string' ? body.workshopId : null

  const stripe = getStripe()
  if (!stripe) return NextResponse.json({ error: 'Payments not configured' }, { status: 503 })

  // 3-pack: 10% off per session.
  const unit = quantity === 3 ? Math.round(SESSION_PRICE_CENTS * 0.9) : SESSION_PRICE_CENTS

  const db = supabaseServer()
  const { data: m } = await db.from('members').select('email, stripe_customer_id').eq('id', member.id).maybeSingle()
  const buyer = m as { email: string | null; stripe_customer_id: string | null } | null

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
  const back = workshopId ? `/community/coaching/${workshopId}/access` : '/community/coaching'
  const checkout = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        quantity,
        price_data: { currency: 'usd', unit_amount: unit, product_data: { name: 'Coaching session' } },
      },
    ],
    ...(buyer?.stripe_customer_id ? { customer: buyer.stripe_customer_id } : buyer?.email ? { customer_email: buyer.email } : {}),
    success_url: `${baseUrl}${back}?topup=1`,
    cancel_url: `${baseUrl}${back}`,
    metadata: { type: 'coaching_topup', memberId: member.id, quantity: String(quantity) },
    payment_intent_data: { metadata: { type: 'coaching_topup', memberId: member.id, quantity: String(quantity) } },
  })

  return NextResponse.json({ url: checkout.url })
}
