import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import { getAcademyDiscountPercent, academyLineItemFromPrice } from '@/lib/academy-discount'

// POST /api/community/sessions/purchase  Body: { sessionType: 'coaching' | 'mentoring' }
// Starts a Stripe Checkout for one additional session (FR-COM-11/12). The price
// comes from the member's tier session-entitlement (extra_stripe_price_id). On
// completion the webhook grants a session_credit, which booking then consumes.
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY not set')
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { sessionType } = await req.json().catch(() => ({}))
  if (sessionType !== 'coaching' && sessionType !== 'mentoring') {
    return NextResponse.json({ error: 'Invalid sessionType' }, { status: 400 })
  }
  if (member.activeTierIds.length === 0) {
    return NextResponse.json({ error: 'No active membership' }, { status: 400 })
  }

  const db = supabaseServer()
  const { data: ents } = await db
    .from('session_entitlements')
    .select('extra_stripe_price_id')
    .eq('session_type', sessionType)
    .in('tier_id', member.activeTierIds)
  const priceId = (ents ?? []).map((e) => e.extra_stripe_price_id).find((p): p is string => !!p)
  if (!priceId) {
    return NextResponse.json(
      { error: 'Additional sessions are not available on your membership.' },
      { status: 400 }
    )
  }

  // Reuse / create the member's Stripe customer.
  const { data: m } = await db
    .from('members')
    .select('id, email, stripe_customer_id')
    .eq('id', member.id)
    .single()

  const stripe = getStripe()
  let customerId = (m?.stripe_customer_id as string | null) ?? null
  if (!customerId && m?.email) {
    const customer = await stripe.customers.create({ email: m.email, metadata: { memberId: member.id } })
    customerId = customer.id
    await db.from('members').update({ stripe_customer_id: customerId }).eq('id', member.id)
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
  const academyPct = await getAcademyDiscountPercent(member.activeTierIds)
  const lineItem = await academyLineItemFromPrice(stripe, priceId, academyPct, `Extra ${sessionType} session`)
  const session = await stripe.checkout.sessions.create({
    customer: customerId ?? undefined,
    mode: 'payment',
    line_items: [lineItem],
    success_url: `${baseUrl}/community/${sessionType}?purchase=success`,
    cancel_url: `${baseUrl}/community/${sessionType}`,
    metadata: { type: 'extra_session', memberId: member.id, sessionType },
  })

  return NextResponse.json({ url: session.url })
}
