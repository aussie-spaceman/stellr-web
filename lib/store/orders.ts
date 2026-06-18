// Order data access + direct-to-consumer fulfilment for the web store (PRD §12).
//
// Storefront orders are "direct": paid via Stripe Checkout, then a Printful order
// is placed immediately and shipped to the buyer's address. Event-batched
// fulfilment (included shirt, add-ons, bulk) is Phase 3-4 and not handled here.

import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseServer } from '@/lib/supabase'
import { logActivity } from '@/lib/activity-log'
import { sendEmail } from '@/lib/email'
import { createOrder, printfulEnabled, type PrintfulItem, type PrintfulRecipient } from './printful'

// Interim flat shipping until Printful live rates are wired in (plan Phase 2).
export const STORE_FLAT_SHIPPING_CENTS = 595

export interface CheckoutLine {
  variantId: string
  sku: string
  name: string // snapshot incl. variant label
  qty: number
  baseCents: number
  unitCents: number // after discount
}

// Insert a pending order + its items. Totals exclude shipping/tax (added from the
// Stripe session at payment time).
export async function createPendingOrder(input: {
  memberId: string | null
  email: string | null
  channel?: 'storefront' | 'reship'
  lines: CheckoutLine[]
}): Promise<{ orderId: string; subtotalCents: number }> {
  const db = supabaseServer()
  const subtotal = input.lines.reduce((s, l) => s + l.unitCents * l.qty, 0)
  const discount = input.lines.reduce((s, l) => s + (l.baseCents - l.unitCents) * l.qty, 0)

  const { data, error } = await db
    .from('store_orders')
    .insert({
      member_id: input.memberId,
      email: input.email ?? '',
      status: 'pending',
      channel: input.channel ?? 'storefront',
      subtotal_cents: subtotal,
      discount_cents: discount,
      total_cents: subtotal,
    })
    .select('id')
    .single()
  if (error) throw new Error(`createPendingOrder: ${error.message}`)
  const orderId = (data as { id: string }).id

  const items = input.lines.map((l) => ({
    order_id: orderId,
    variant_id: l.variantId,
    sku: l.sku,
    name: l.name,
    qty: l.qty,
    unit_amount_cents: l.unitCents,
    line_source: 'storefront',
    fulfillment_mode: 'direct',
    fulfillment_status: 'pending',
  }))
  const { error: itemErr } = await db.from('store_order_items').insert(items)
  if (itemErr) throw new Error(`createPendingOrder items: ${itemErr.message}`)

  return { orderId, subtotalCents: subtotal }
}

// Defensive shipping-address read — Stripe moved the field between API versions
// (shipping_details → collected_information.shipping_details); fall back to the
// billing/customer address.
export function recipientFromSession(session: Stripe.Checkout.Session): PrintfulRecipient | null {
  const loose = session as unknown as {
    shipping_details?: { name?: string | null; address?: Stripe.Address | null }
    collected_information?: { shipping_details?: { name?: string | null; address?: Stripe.Address | null } }
  }
  const sd = loose.shipping_details ?? loose.collected_information?.shipping_details
  const addr = sd?.address ?? session.customer_details?.address ?? null
  const name = sd?.name ?? session.customer_details?.name ?? null
  if (!addr || !addr.line1 || !addr.city || !addr.country) return null
  return {
    name: name ?? 'Customer',
    address1: addr.line1,
    address2: addr.line2 ?? undefined,
    city: addr.city,
    state_code: addr.state ?? '',
    country_code: addr.country,
    zip: addr.postal_code ?? '',
    email: session.customer_details?.email ?? undefined,
  }
}

// Place the Printful order for a paid storefront order. Best-effort: a failure
// leaves the order 'paid' (fulfilment can be retried/handled manually) and never
// throws into the webhook.
async function fulfilDirect(db: SupabaseClient, orderId: string, recipient: PrintfulRecipient | null) {
  try {
    if (!printfulEnabled() || !recipient) return
    const { data: items } = await db
      .from('store_order_items')
      .select('id, qty, variant:store_variants(pod_sync_variant_id)')
      .eq('order_id', orderId)

    const pfItems: PrintfulItem[] = []
    for (const it of items ?? []) {
      const variant = (it as { variant?: { pod_sync_variant_id?: string | null } | null }).variant
      const podId = variant?.pod_sync_variant_id
      if (podId) pfItems.push({ sync_variant_id: Number(podId), quantity: (it as { qty: number }).qty })
    }
    if (pfItems.length === 0) return // nothing POD-backed to fulfil

    const pfOrder = await createOrder({ recipient, items: pfItems, external_id: orderId, confirm: true })
    await db
      .from('store_orders')
      .update({ status: 'fulfilling', pod_order_id: String(pfOrder.id) })
      .eq('id', orderId)
    await db.from('store_order_items').update({ fulfillment_status: 'ordered' }).eq('order_id', orderId)
  } catch (err) {
    console.error('[store/orders] fulfilDirect failed (order stays paid):', err)
  }
}

function orderEmail(orderId: string, totalCents: number) {
  const total = (totalCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  const ref = orderId.slice(0, 8)
  return {
    subject: `Your Stellr order ${ref} is confirmed`,
    html: `<p>Thanks for your order!</p><p>Order <strong>${ref}</strong> — total ${total}. We'll email tracking once it ships.</p>`,
    text: `Thanks for your order! Order ${ref} — total ${total}. We'll email tracking once it ships.`,
  }
}

// Webhook entry point: a storefront Checkout session completed. Idempotent —
// only acts while the order is still 'pending'.
export async function handleStoreOrderPaid(session: Stripe.Checkout.Session): Promise<void> {
  const db = supabaseServer()
  const orderId = session.metadata?.orderId
  if (!orderId) return

  const { data: order } = await db
    .from('store_orders')
    .select('id, member_id, email, status, subtotal_cents')
    .eq('id', orderId)
    .maybeSingle()
  const o = order as { id: string; member_id: string | null; email: string; status: string; subtotal_cents: number } | null
  if (!o || o.status !== 'pending') return // already settled or missing

  const pi = typeof session.payment_intent === 'string' ? session.payment_intent : null
  const shipping = session.total_details?.amount_shipping ?? 0
  const tax = session.total_details?.amount_tax ?? 0
  const total = session.amount_total ?? o.subtotal_cents
  const recipient = recipientFromSession(session)

  await db
    .from('store_orders')
    .update({
      status: 'paid',
      stripe_payment_intent_id: pi,
      stripe_checkout_session_id: session.id,
      shipping_cents: shipping,
      tax_cents: tax,
      total_cents: total,
      ship_to: recipient
        ? {
            name: recipient.name,
            line1: recipient.address1,
            line2: recipient.address2 ?? null,
            city: recipient.city,
            state: recipient.state_code,
            postcode: recipient.zip,
            country: recipient.country_code,
          }
        : null,
    })
    .eq('id', orderId)

  // Persist the Stripe customer on the member (mirrors event/membership flow).
  const customerId = typeof session.customer === 'string' ? session.customer : null
  const email = session.customer_details?.email ?? o.email
  if (customerId && email) {
    await db.from('members').update({ stripe_customer_id: customerId }).eq('email', email).is('stripe_customer_id', null)
  }

  await fulfilDirect(db, orderId, recipient)

  if (o.member_id) {
    await logActivity(
      {
        memberId: o.member_id,
        category: 'billing',
        action: 'order_placed',
        summary: `Store order placed${total ? ` ($${(total / 100).toFixed(2)})` : ''}`,
        metadata: { kind: 'store', orderId, amount: total, currency: session.currency ?? 'usd' },
        actorType: 'stripe',
      },
      db,
    )
  }

  if (o.email) {
    await sendEmail({ to: o.email, ...orderEmail(orderId, total) })
  }
}
