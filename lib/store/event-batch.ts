// Event-merch bulk fulfilment (PRD §12, Phase 4).
//
// All of an event's batch-mode items (included shirts + paid add-ons) sit as
// 'awaiting_batch' until an Event Manager commits them: we create one merch_batch,
// place a SINGLE Printful order for the aggregated quantities shipped to the
// venue, and flip the items to 'ordered'. Committing locks event-merch refunds.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createOrder, printfulEnabled, type PrintfulItem, type PrintfulRecipient } from './printful'

const arr = <T>(x: T | T[] | null | undefined): T | undefined => (Array.isArray(x) ? x[0] : (x ?? undefined))

export interface ShipTo {
  name: string
  line1: string
  line2?: string | null
  city: string
  state: string
  postcode: string
  country?: string
}

function shipToRecipient(s: ShipTo): PrintfulRecipient {
  return {
    name: s.name,
    address1: s.line1,
    address2: s.line2 ?? undefined,
    city: s.city,
    state_code: s.state,
    country_code: s.country || 'US',
    zip: s.postcode,
  }
}

export interface BatchSummary {
  awaitingCount: number
  batch: { id: string; status: string; pod_order_id: string | null; tracking_url: string | null; committed_at: string | null } | null
}

export async function getEventBatchSummary(db: SupabaseClient, eventSlug: string): Promise<BatchSummary> {
  const [{ count }, { data: batch }] = await Promise.all([
    db
      .from('store_order_items')
      .select('id, store_orders!inner(event_slug)', { count: 'exact', head: true })
      .eq('fulfillment_mode', 'batch')
      .eq('fulfillment_status', 'awaiting_batch')
      .eq('store_orders.event_slug', eventSlug),
    db
      .from('merch_batches')
      .select('id, status, pod_order_id, tracking_url, committed_at')
      .eq('event_slug', eventSlug)
      .eq('batch_type', 'event_venue')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  return {
    awaitingCount: count ?? 0,
    batch: (batch as BatchSummary['batch']) ?? null,
  }
}

// Commit all awaiting items for the event into one bulk Printful order to the
// venue. Throws on conflict (already committed) or empty batch.
export async function commitEventBatch(
  db: SupabaseClient,
  eventSlug: string,
  shipTo: ShipTo,
  committedBy: string | null,
): Promise<{ batchId: string; items: number; podOrderId: string | null }> {
  const { data: existing } = await db
    .from('merch_batches')
    .select('id, status')
    .eq('event_slug', eventSlug)
    .eq('batch_type', 'event_venue')
    .neq('status', 'open')
    .maybeSingle()
  if (existing) throw new Error('This event already has a committed merch batch.')

  const { data: itemRows } = await db
    .from('store_order_items')
    .select('id, qty, variant:store_variants(pod_sync_variant_id), store_orders!inner(event_slug)')
    .eq('fulfillment_mode', 'batch')
    .eq('fulfillment_status', 'awaiting_batch')
    .eq('store_orders.event_slug', eventSlug)
  const items = (itemRows ?? []) as { id: string; qty: number; variant?: unknown }[]
  if (items.length === 0) throw new Error('No items are awaiting a batch for this event.')

  // Aggregate quantities by Printful sync variant.
  const qtyByVariant = new Map<number, number>()
  for (const it of items) {
    const v = arr(it.variant) as { pod_sync_variant_id?: string | null } | undefined
    const pod = v?.pod_sync_variant_id
    if (pod) qtyByVariant.set(Number(pod), (qtyByVariant.get(Number(pod)) ?? 0) + it.qty)
  }

  const { data: batchRow, error: batchErr } = await db
    .from('merch_batches')
    .insert({ batch_type: 'event_venue', event_slug: eventSlug, ship_to: shipTo, status: 'open', committed_by: committedBy })
    .select('id')
    .single()
  if (batchErr || !batchRow) throw new Error('Could not create batch')
  const batchId = (batchRow as { id: string }).id

  await db.from('store_order_items').update({ batch_id: batchId }).in('id', items.map((i) => i.id))

  let podOrderId: string | null = null
  if (printfulEnabled() && qtyByVariant.size > 0) {
    const pfItems: PrintfulItem[] = [...qtyByVariant.entries()].map(([sync_variant_id, quantity]) => ({ sync_variant_id, quantity }))
    const pfOrder = await createOrder({ recipient: shipToRecipient(shipTo), items: pfItems, external_id: batchId, confirm: true })
    podOrderId = String(pfOrder.id)
  }

  await db
    .from('merch_batches')
    .update({ status: 'ordered', pod_order_id: podOrderId, committed_at: new Date().toISOString() })
    .eq('id', batchId)
  await db.from('store_order_items').update({ fulfillment_status: 'ordered' }).eq('batch_id', batchId)

  return { batchId, items: items.length, podOrderId }
}
