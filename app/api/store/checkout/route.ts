import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { computeUnitPrice } from '@/lib/store/pricing'
import { createPendingOrder, STORE_FLAT_SHIPPING_CENTS, type CheckoutLine } from '@/lib/store/orders'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

// Storefront checkout. Re-derives every price server-side (tier discount applied
// for logged-in members), creates a pending order, and returns a Stripe Checkout
// URL. Works for guests and members.
export async function POST(req: Request) {
  const stripe = getStripe()
  if (!stripe) return NextResponse.json({ error: 'Payments not configured' }, { status: 503 })

  const body = await req.json().catch(() => ({}))
  const rawItems = Array.isArray(body?.items) ? body.items : []
  const reqMap = new Map<string, number>()
  for (const it of rawItems) {
    const id = String(it?.variantId || '')
    const qty = Math.max(1, Math.floor(Number(it?.qty) || 1))
    if (id) reqMap.set(id, (reqMap.get(id) ?? 0) + qty)
  }
  const variantIds = [...reqMap.keys()]
  if (variantIds.length === 0) return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })

  const db = supabaseServer()

  // Resolve the buyer (optional — guests allowed) and their active tier.
  let memberId: string | null = null
  let email: string | null = null
  let customerId: string | null = null
  let tierId: string | null = null
  const { userId } = await auth()
  if (userId) {
    const { data: m } = await db
      .from('members')
      .select('id, email, stripe_customer_id')
      .eq('clerk_user_id', userId)
      .maybeSingle()
    const member = m as { id: string; email: string | null; stripe_customer_id: string | null } | null
    if (member) {
      memberId = member.id
      email = member.email
      customerId = member.stripe_customer_id
      const { data: mem } = await db
        .from('member_memberships')
        .select('tier_id')
        .eq('member_id', member.id)
        .eq('renewal_status', 'active')
        .maybeSingle()
      tierId = (mem as { tier_id?: string | null } | null)?.tier_id ?? null
    }
  }

  const { data: variants } = await db
    .from('store_variants')
    .select('id, sku, label, market_price_cents, active, product:store_products(id, name, status, product_type)')
    .in('id', variantIds)

  const lines: CheckoutLine[] = []
  const stripeLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = []
  for (const v of variants ?? []) {
    const row = v as {
      id: string
      sku: string
      label: string | null
      market_price_cents: number
      active: boolean
      product: { id: string; name: string; status: string; product_type: string } | { id: string; name: string; status: string; product_type: string }[] | null
    }
    const product = Array.isArray(row.product) ? row.product[0] : row.product
    if (!row.active || !product || product.status !== 'active') continue
    const qty = reqMap.get(row.id)!
    const price = await computeUnitPrice(
      { market_price_cents: row.market_price_cents, product_id: product.id },
      { product_type: product.product_type },
      { kind: 'storefront', tierId },
    )
    const name = `${product.name}${row.label ? ` — ${row.label}` : ''}`
    lines.push({ variantId: row.id, sku: row.sku, name, qty, baseCents: price.base_cents, unitCents: price.unit_cents })
    stripeLineItems.push({
      quantity: qty,
      price_data: { currency: 'usd', unit_amount: price.unit_cents, product_data: { name } },
    })
  }
  if (lines.length === 0) return NextResponse.json({ error: 'No purchasable items in cart' }, { status: 400 })

  const { orderId } = await createPendingOrder({ memberId, email, lines })

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: stripeLineItems,
    ...(customerId ? { customer: customerId } : email ? { customer_email: email } : {}),
    shipping_address_collection: { allowed_countries: ['US'] },
    shipping_options: [
      {
        shipping_rate_data: {
          type: 'fixed_amount',
          fixed_amount: { amount: STORE_FLAT_SHIPPING_CENTS, currency: 'usd' },
          display_name: 'Standard shipping',
        },
      },
    ],
    phone_number_collection: { enabled: true },
    success_url: `${baseUrl}/store/success?order=${orderId}`,
    cancel_url: `${baseUrl}/store/cart`,
    metadata: { type: 'store_order', orderId },
    payment_intent_data: { metadata: { type: 'store_order', orderId } },
  })

  return NextResponse.json({ url: session.url })
}
