import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { verifyPrintfulWebhook } from '@/lib/store/printful'
import { auditMutation } from '@/lib/audit/route'

export const dynamic = 'force-dynamic'

// Printful fulfilment webhook (PRD §12). Authenticated by PRINTFUL_WEBHOOK_SECRET in
// the `x-printful-secret` request header, and only there: a `?secret=` query
// parameter is refused (threat model R4b; setup in docs/WEB-STORE-PRINTFUL-SETUP.md
// §4). Handles shipment + failure events for direct storefront orders (event-batch
// tracking lands in Phase 4).
//
// One audit event for an event that changed a row (docs/TENANCY-S5.md, B18). Anything
// else answers ok before the write, as it always has, and records nothing. A tracking
// URL stays out of the event: it leads to the details of someone's delivery.
export async function POST(req: Request) {
  if (!verifyPrintfulWebhook(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as
    | { type?: string; data?: { order?: { id?: number | string; external_id?: string | null }; shipment?: { tracking_url?: string | null } } }
    | null
  if (!body?.type) return NextResponse.json({ ok: true })

  const isShipped = body.type === 'package_shipped'
  const isStopped = body.type === 'order_failed' || body.type === 'order_canceled'
  if (!isShipped && !isStopped) return NextResponse.json({ ok: true })

  const order = body.data?.order ?? {}
  const externalId = order.external_id || null // our store_orders.id
  const podId = order.id != null ? String(order.id) : null

  const db = supabaseServer()
  const tracking = body.data?.shipment?.tracking_url ?? null

  // A Printful order's external_id is either a direct store_orders.id (DTC) or a
  // merch_batches.id (event-batched). Try the order first, then the batch.
  const { data: orderRow } = externalId
    ? await db.from('store_orders').select('id').eq('id', externalId).maybeSingle()
    : podId
      ? await db.from('store_orders').select('id').eq('pod_order_id', podId).maybeSingle()
      : { data: null }
  const orderId = (orderRow as { id?: string } | null)?.id

  // A batch is only ever updated on a shipment, so a failure with no order stops here.
  if (!orderId && !isShipped) return NextResponse.json({ ok: true })
  const { data: batchRow } = orderId
    ? { data: null }
    : externalId
      ? await db.from('merch_batches').select('id').eq('id', externalId).maybeSingle()
      : podId
        ? await db.from('merch_batches').select('id').eq('pod_order_id', podId).maybeSingle()
        : { data: null }
  const batchId = (batchRow as { id?: string } | null)?.id
  if (!orderId && !batchId) return NextResponse.json({ ok: true })

  let target: { table: string; id: string | null }
  let results: { error: unknown }[]
  if (orderId) {
    target = { table: 'store_orders', id: orderId }
    results = isShipped
      ? [
          await db.from('store_orders').update({ status: 'shipped', tracking_url: tracking }).eq('id', orderId),
          await db.from('store_order_items').update({ fulfillment_status: 'shipped' }).eq('order_id', orderId),
        ]
      : [await db.from('store_orders').update({ status: 'cancelled' }).eq('id', orderId)]
  } else {
    target = { table: 'merch_batches', id: batchId ?? null }
    results = [
      await db.from('merch_batches').update({ status: 'shipped', tracking_url: tracking }).eq('id', batchId),
      await db.from('store_order_items').update({ fulfillment_status: 'shipped' }).eq('batch_id', batchId),
    ]
  }

  await auditMutation(
    {
      action: 'store.order.fulfilment_update',
      actor: { webhook: 'printful' },
      tenant: { stellr: true },
      target,
      metadata: { event_type: body.type, write_failed: results.some((r) => !!r.error) },
    },
    { afterResponse: true },
  )

  return NextResponse.json({ ok: true })
}
