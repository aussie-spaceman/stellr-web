import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY not set')
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json() as { tierId: string; billingInterval: 'monthly' | 'annual' }
  const { tierId, billingInterval } = body

  if (!tierId || !billingInterval) {
    return NextResponse.json({ error: 'Missing tierId or billingInterval' }, { status: 400 })
  }

  const db = supabaseServer()

  // Get the tier and its price IDs
  const { data: tier } = await db
    .from('membership_tiers')
    .select('id, name, stripe_price_id, stripe_price_id_monthly, is_free')
    .eq('id', tierId)
    .single()

  if (!tier || tier.is_free) {
    return NextResponse.json({ error: 'Invalid tier' }, { status: 400 })
  }

  const priceId = billingInterval === 'monthly'
    ? tier.stripe_price_id_monthly
    : tier.stripe_price_id

  if (!priceId) {
    return NextResponse.json(
      { error: `No ${billingInterval} price configured for ${tier.name}` },
      { status: 400 }
    )
  }

  // Get the member record
  const { data: member } = await db
    .from('members')
    .select('id, email, stripe_customer_id')
    .eq('clerk_user_id', userId)
    .single()

  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  const stripe = getStripe()
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

  // Create or reuse Stripe customer
  let customerId = member.stripe_customer_id as string | null
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: member.email,
      metadata: { memberId: member.id, clerkUserId: userId },
    })
    customerId = customer.id
    await db.from('members').update({ stripe_customer_id: customerId }).eq('id', member.id)
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${baseUrl}/account?membership=success`,
    cancel_url: `${baseUrl}/membership`,
    metadata: {
      type: 'membership',
      memberId: member.id,
      tierId: tier.id,
      billingInterval,
    },
    subscription_data: {
      metadata: {
        type: 'membership',
        memberId: member.id,
        tierId: tier.id,
        billingInterval,
      },
    },
  })

  return NextResponse.json({ url: session.url })
}
