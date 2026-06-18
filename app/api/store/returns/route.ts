import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { currentStoreMember } from '@/lib/store/auth'
import { canManageStoreCatalog } from '@/lib/store/auth'

export const dynamic = 'force-dynamic'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

// DTC returns (PRD §12): general store merch is refundable per Printful policy;
// event/campaign batch merch is NOT (locked once committed). Members request;
// admins approve + refund.
//   POST  { orderId, reason }            — member requests a return on a DTC order
//   PATCH { returnId, action }           — admin approves (Stripe refund) or denies
export async function POST(req: Request) {
  const member = await currentStoreMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const { orderId, reason } = body
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 })

  const db = supabaseServer()
  const { data: order } = await db
    .from('store_orders')
    .select('id, member_id, channel, status')
    .eq('id', orderId)
    .maybeSingle()
  const o = order as { id: string; member_id: string | null; channel: string; status: string } | null
  if (!o || o.member_id !== member.id) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  // Event/campaign merch is non-refundable once the bulk order is committed.
  if (o.channel !== 'storefront') {
    return NextResponse.json({ error: 'Event merchandise is not returnable.' }, { status: 400 })
  }

  const { error } = await db.from('store_returns').insert({
    order_id: orderId,
    member_id: member.id,
    reason: reason ?? null,
    status: 'requested',
  })
  if (error) return NextResponse.json({ error: 'Could not submit return' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: Request) {
  if (!(await canManageStoreCatalog())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const { returnId, action } = body
  if (!returnId || (action !== 'approve' && action !== 'deny')) {
    return NextResponse.json({ error: "returnId and action (approve|deny) required" }, { status: 400 })
  }

  const db = supabaseServer()
  const { data: ret } = await db.from('store_returns').select('id, order_id, status').eq('id', returnId).maybeSingle()
  const r = ret as { id: string; order_id: string; status: string } | null
  if (!r) return NextResponse.json({ error: 'Return not found' }, { status: 404 })

  if (action === 'deny') {
    await db.from('store_returns').update({ status: 'denied' }).eq('id', returnId)
    return NextResponse.json({ ok: true })
  }

  // Approve → refund the order's payment intent via Stripe.
  const { data: order } = await db.from('store_orders').select('stripe_payment_intent_id').eq('id', r.order_id).maybeSingle()
  const pi = (order as { stripe_payment_intent_id?: string | null } | null)?.stripe_payment_intent_id
  const stripe = getStripe()
  let refundId: string | null = null
  if (stripe && pi) {
    try {
      const refund = await stripe.refunds.create({ payment_intent: pi })
      refundId = refund.id
    } catch (err) {
      return NextResponse.json({ error: `Refund failed: ${(err as Error).message}` }, { status: 502 })
    }
  }
  await db.from('store_returns').update({ status: 'refunded', stripe_refund_id: refundId }).eq('id', returnId)
  await db.from('store_orders').update({ status: 'refunded' }).eq('id', r.order_id)
  return NextResponse.json({ ok: true, refundId })
}
