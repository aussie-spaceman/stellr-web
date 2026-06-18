import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { currentStoreMember } from '@/lib/store/auth'
import { createPendingOrder, STORE_FLAT_SHIPPING_CENTS } from '@/lib/store/orders'

export const dynamic = 'force-dynamic'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

// Reship uncollected event merch to the member's home address, at their cost
// (PRD §12 — non-attendance). The merch itself is already paid (event fee / add-on
// payment), so the member pays only the reship fee; on payment the existing
// store-order webhook places a direct Printful order to the collected address.
export async function POST(req: Request) {
  const stripe = getStripe()
  if (!stripe) return NextResponse.json({ error: 'Payments not configured' }, { status: 503 })

  const member = await currentStoreMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const orderId = body?.orderId
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 })

  const db = supabaseServer()
  // The source must be this member's event-merch order.
  const { data: src } = await db
    .from('store_orders')
    .select('id, member_id, channel, items:store_order_items(variant_id, sku, name, qty)')
    .eq('id', orderId)
    .maybeSingle()
  const order = src as { id: string; member_id: string | null; channel: string; items: { variant_id: string; sku: string; name: string; qty: number }[] } | null
  if (!order || order.member_id !== member.id || order.channel !== 'event_registration') {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }
  if (!order.items || order.items.length === 0) {
    return NextResponse.json({ error: 'Nothing to reship' }, { status: 400 })
  }

  // Create the reship order: same items at $0 (already paid), direct fulfilment.
  const { orderId: reshipId } = await createPendingOrder({
    memberId: member.id,
    email: member.email,
    channel: 'reship',
    lines: order.items.map((i) => ({
      variantId: i.variant_id,
      sku: i.sku ?? '',
      name: i.name ?? 'Item',
      qty: i.qty,
      baseCents: 0,
      unitCents: 0,
    })),
  })

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        quantity: 1,
        price_data: { currency: 'usd', unit_amount: STORE_FLAT_SHIPPING_CENTS, product_data: { name: 'Merch reshipment' } },
      },
    ],
    ...(member.email ? { customer_email: member.email } : {}),
    shipping_address_collection: { allowed_countries: ['US'] },
    success_url: `${baseUrl}/store/success?order=${reshipId}`,
    cancel_url: `${baseUrl}/account`,
    metadata: { type: 'store_order', orderId: reshipId },
    payment_intent_data: { metadata: { type: 'store_order', orderId: reshipId } },
  })

  return NextResponse.json({ url: session.url })
}
