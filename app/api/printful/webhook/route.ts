import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { verifyPrintfulWebhook } from '@/lib/store/printful'

export const dynamic = 'force-dynamic'

// Printful fulfilment webhook (PRD §12). Configure the endpoint URL in Printful
// with ?secret=<PRINTFUL_WEBHOOK_SECRET>. Handles shipment + failure events for
// direct storefront orders (event-batch tracking lands in Phase 4).
export async function POST(req: Request) {
  if (!verifyPrintfulWebhook(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as
    | { type?: string; data?: { order?: { id?: number | string; external_id?: string | null }; shipment?: { tracking_url?: string | null } } }
    | null
  if (!body?.type) return NextResponse.json({ ok: true })

  const order = body.data?.order ?? {}
  const externalId = order.external_id || null // our store_orders.id
  const podId = order.id != null ? String(order.id) : null

  const db = supabaseServer()
  const { data: row } = externalId
    ? await db.from('store_orders').select('id').eq('id', externalId).maybeSingle()
    : podId
      ? await db.from('store_orders').select('id').eq('pod_order_id', podId).maybeSingle()
      : { data: null }
  const orderId = (row as { id?: string } | null)?.id
  if (!orderId) return NextResponse.json({ ok: true })

  if (body.type === 'package_shipped') {
    const tracking = body.data?.shipment?.tracking_url ?? null
    await db.from('store_orders').update({ status: 'shipped', tracking_url: tracking }).eq('id', orderId)
    await db.from('store_order_items').update({ fulfillment_status: 'shipped' }).eq('order_id', orderId)
  } else if (body.type === 'order_failed' || body.type === 'order_canceled') {
    await db.from('store_orders').update({ status: 'cancelled' }).eq('id', orderId)
  }

  return NextResponse.json({ ok: true })
}
