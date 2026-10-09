import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { currentStoreMember } from '@/lib/store/auth'
import { createPendingOrder, STORE_FLAT_SHIPPING_CENTS } from '@/lib/store/orders'
import { stripeClient } from '@/lib/stripe'
import { getEventBySlug } from '@/lib/sanity'

export const dynamic = 'force-dynamic'

interface SourceItem {
  variant_id: string
  sku: string | null
  name: string | null
  qty: number
  participant_member_id: string | null
  fulfillment_status: string | null
}

// deep review PAY-2: the event must actually be over before merch is reshipped
// (reship is the non-attendance path). Fail closed — if we can't confirm the
// event has ended (no Sanity client, missing/invalid date), do NOT ship.
async function eventHasEnded(slug: string | null): Promise<boolean> {
  if (!slug) return false
  const event = await getEventBySlug(slug).catch(() => null)
  const raw = (event as { endDate?: string | null; date?: string | null } | null)
  const when = raw?.endDate ?? raw?.date ?? null
  if (!when) return false
  const ts = Date.parse(when)
  if (Number.isNaN(ts)) return false
  return ts < Date.now()
}

// Reship uncollected event merch to the member's home address, at their cost
// (PRD §12 — non-attendance). The merch itself is already paid (event fee / add-on
// payment), so the member pays only the reship fee; on payment the existing
// store-order webhook places a direct Printful order to the collected address.
//
// deep review PAY-2: the business rules below used to live only in the React
// button. The server copied the whole event-merch order (every participant's
// shirt + any still-unpaid add-ons) into a $0 order and would do it again on
// every call. We now enforce, server-side: the source order is paid; the caller
// has an uncollected seat on it; the event is over; this order has not already
// been reshipped; and only the caller's own, actually-paid items are copied.
export async function POST(req: Request) {
  const stripe = stripeClient()
  if (!stripe) return NextResponse.json({ error: 'Payments not configured' }, { status: 503 })

  const member = await currentStoreMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const orderId = body?.orderId
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 })

  const db = supabaseServer()
  // The source must be this member's PAID event-merch order.
  const { data: src } = await db
    .from('store_orders')
    .select(
      'id, member_id, channel, status, event_slug, registration_id, ' +
        'items:store_order_items(variant_id, sku, name, qty, participant_member_id, fulfillment_status)',
    )
    .eq('id', orderId)
    .maybeSingle()
  const order = src as {
    id: string
    member_id: string | null
    channel: string
    status: string | null
    event_slug: string | null
    registration_id: string | null
    items: SourceItem[]
  } | null
  // A reship is only ever of the caller's own event-merch order, and only once
  // it is paid. Anything else is "not found" (don't leak why).
  if (
    !order ||
    order.member_id !== member.id ||
    order.channel !== 'event_registration' ||
    order.status !== 'paid'
  ) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  // The caller must have an uncollected seat on this registration. Collecting
  // the shirt at the event (merch_collected) rules out a reship of it.
  const { data: mineRow } = await db
    .from('participants')
    .select('id, merch_collected')
    .eq('registration_id', order.registration_id)
    .eq('member_id', member.id)
    .maybeSingle()
  const mine = mineRow as { id: string; merch_collected: boolean | null } | null
  if (!mine || mine.merch_collected) {
    return NextResponse.json({ error: 'Not eligible for reshipment' }, { status: 400 })
  }

  // Reship is the after-the-event, didn't-attend path — refuse before the event.
  if (!(await eventHasEnded(order.event_slug))) {
    return NextResponse.json({ error: 'Reshipment opens after the event' }, { status: 400 })
  }

  // One reship per source order. The DB unique partial index is the race-safe
  // backstop for a double-submit; this check gives a clean 409.
  const { count } = await db
    .from('store_orders')
    .select('id', { count: 'exact', head: true })
    .eq('source_order_id', order.id)
    .eq('channel', 'reship')
    .neq('status', 'cancelled')
  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: 'Already reshipped' }, { status: 409 })
  }

  // Copy ONLY this member's own items that were actually paid/allocated. A
  // 'pending' item is an add-on whose registration was never paid — it must
  // never ship, and another participant's shirt is not ours to reship.
  const reshipLines = (order.items ?? [])
    .filter((i) => i.participant_member_id === member.id && i.fulfillment_status !== 'pending')
    .map((i) => ({
      variantId: i.variant_id,
      sku: i.sku ?? '',
      name: i.name ?? 'Item',
      qty: i.qty,
      baseCents: 0,
      unitCents: 0,
    }))
  if (reshipLines.length === 0) {
    return NextResponse.json({ error: 'Nothing to reship' }, { status: 400 })
  }

  // Create the reship order: same items at $0 (already paid), direct fulfilment.
  const { orderId: reshipId } = await createPendingOrder({
    memberId: member.id,
    email: member.email,
    channel: 'reship',
    sourceOrderId: order.id,
    lines: reshipLines,
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
