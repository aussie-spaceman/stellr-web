import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { buildCreditDiscount } from '@/lib/refunds/redeem'
import { ensureStripeCustomer } from '@/lib/stripe-customer'

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

  const body = await req.json() as { tierId?: string; tierName?: string; billingInterval: 'monthly' | 'annual' }
  const { tierId, tierName, billingInterval } = body

  if ((!tierId && !tierName) || !billingInterval) {
    return NextResponse.json({ error: 'Missing tierId/tierName or billingInterval' }, { status: 400 })
  }

  const db = supabaseServer()

  // Get the tier and its price IDs — look up by id or by name
  const tierBase = db.from('membership_tiers').select('id, name, stripe_price_id, stripe_price_id_monthly, is_free')
  const { data: tier } = tierId
    ? await tierBase.eq('id', tierId).single()
    : await tierBase.eq('name', tierName!).single()

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
    .select('id, email, first_name, last_name, stripe_customer_id')
    .eq('clerk_user_id', userId)
    .single()

  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  const stripe = getStripe()
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

  try {
    // Resolve a valid Stripe customer (self-heals a stale/missing stored id).
    const customerId = await ensureStripeCustomer(stripe, db, member, userId)

    // Apply any available account credit (issued from a prior refund) to the first
    // invoice. Allocations are settled in the webhook once payment completes.
    let discount: Awaited<ReturnType<typeof buildCreditDiscount>> = null
    try {
      const price = await stripe.prices.retrieve(priceId)
      if (price.unit_amount && price.currency) {
        discount = await buildCreditDiscount(stripe, member.id as string, price.currency, price.unit_amount)
      }
    } catch (e) {
      console.error('[membership-checkout] credit application skipped:', e)
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      discounts: discount ? [{ coupon: discount.couponId }] : undefined,
      success_url: `${baseUrl}/account?membership=success`,
      cancel_url: `${baseUrl}/membership`,
      metadata: {
        type: 'membership',
        memberId: member.id,
        tierId: tier.id,
        billingInterval,
        ...(discount ? { creditMemberId: member.id as string, creditAllocations: JSON.stringify(discount.allocations) } : {}),
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
  } catch (err) {
    console.error('[membership-checkout] failed:', err)
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 500 })
  }
}
