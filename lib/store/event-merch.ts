// Event-merchandise allocation for the web store (PRD §12, Phase 3 + 3b).
//
// One event-merch order per registration (channel='event_registration') holds
// both the free "included" shirt (one per participant, sized from their t-shirt
// size) and any paid add-ons bought during registration. Everything is batch-mode
// (fulfillment_status flows pending → awaiting_batch → ordered) and is rolled into
// the Event Manager's single bulk Printful order in Phase 4.
//
// Lifecycle:
//   • at registration: add-ons inserted as 'pending' (payment not yet cleared)
//   • on confirmation: included shirts allocated + add-ons flipped to
//     'awaiting_batch' + the order marked 'paid' (finalizeRegistrationMerch)

import type { SupabaseClient } from '@supabase/supabase-js'
import { computeUnitPrice } from './pricing'

const arr = <T>(x: T | T[] | null | undefined): T | undefined =>
  Array.isArray(x) ? x[0] : (x ?? undefined)

function normSize(s: unknown): string {
  return String(s ?? '').trim().toLowerCase().replace(/\s*\(.*\)\s*/g, '')
}

interface VariantLite {
  id: string
  label: string | null
  options: Record<string, string> | null
  sku: string
  active?: boolean
}

// Pick the variant of an included product that matches a participant's size.
export function resolveVariantForSize(variants: VariantLite[], size: unknown): VariantLite | null {
  const s = normSize(size)
  if (!s) return null
  for (const v of variants) {
    if (v.options?.size && normSize(v.options.size) === s) return v
  }
  for (const v of variants) {
    const tokens = String(v.label ?? '').toLowerCase().split(/[/,]/).map((t) => normSize(t))
    if (tokens.includes(s)) return v
  }
  return null
}

interface IncludedOffering {
  productId: string
  productName: string
  variants: VariantLite[]
  fallbackVariant: VariantLite | null
}

async function getIncludedOfferings(db: SupabaseClient, eventSlug: string): Promise<IncludedOffering[]> {
  const { data: offs } = await db
    .from('event_store_offerings')
    .select('id, variant_id, treatment, variant:store_variants(id, product_id)')
    .eq('event_slug', eventSlug)
    .eq('treatment', 'included')

  const result: IncludedOffering[] = []
  for (const o of offs ?? []) {
    const v = arr((o as { variant?: unknown }).variant) as { id: string; product_id: string } | undefined
    const productId = v?.product_id
    if (!productId) continue
    const { data: product } = await db.from('store_products').select('name').eq('id', productId).maybeSingle()
    const { data: variants } = await db
      .from('store_variants')
      .select('id, label, options, sku, active')
      .eq('product_id', productId)
      .eq('active', true)
    const vlist = (variants ?? []) as VariantLite[]
    result.push({
      productId,
      productName: (product as { name?: string } | null)?.name ?? 'Event shirt',
      variants: vlist,
      fallbackVariant: vlist.find((x) => x.id === v?.id) ?? vlist[0] ?? null,
    })
  }
  return result
}

// Get (or create) the single event-merch order for a registration.
async function ensureEventMerchOrder(db: SupabaseClient, registrationId: string): Promise<string | null> {
  const { data: existing } = await db
    .from('store_orders')
    .select('id')
    .eq('registration_id', registrationId)
    .eq('channel', 'event_registration')
    .maybeSingle()
  if (existing) return (existing as { id: string }).id

  const { data: reg } = await db
    .from('registrations')
    .select('event_slug, teacher_member_id, teacher_email')
    .eq('id', registrationId)
    .maybeSingle()
  const r = reg as { event_slug: string | null; teacher_member_id: string | null; teacher_email: string | null } | null
  if (!r?.event_slug) return null

  const { data: firstPart } = await db
    .from('participants')
    .select('member_id')
    .eq('registration_id', registrationId)
    .not('member_id', 'is', null)
    .limit(1)
    .maybeSingle()

  const { data: order } = await db
    .from('store_orders')
    .insert({
      member_id: r.teacher_member_id ?? (firstPart as { member_id?: string } | null)?.member_id ?? null,
      email: r.teacher_email ?? '',
      status: 'pending',
      channel: 'event_registration',
      event_slug: r.event_slug,
      registration_id: registrationId,
      subtotal_cents: 0,
      discount_cents: 0,
      total_cents: 0,
    })
    .select('id')
    .single()
  return (order as { id?: string } | null)?.id ?? null
}

export interface AddonLine {
  variantId: string
  sku: string
  name: string
  qty: number
  unitCents: number
}

// Validate + price a registrant's add-on selections against the event's 'addon'
// offerings (event-discount applied). Ignores anything not actually offered.
export async function prepareRegistrationAddons(
  db: SupabaseClient,
  eventSlug: string,
  selections: { variantId: string; qty: number }[],
): Promise<AddonLine[]> {
  if (!selections || selections.length === 0) return []
  const { data: offs } = await db
    .from('event_store_offerings')
    .select('variant:store_variants(id, sku, label, market_price_cents, active, product:store_products(id, name, product_type, status))')
    .eq('event_slug', eventSlug)
    .eq('treatment', 'addon')

  const allowed = new Map<string, { sku: string; name: string; productId: string; productType: string; priceCents: number }>()
  for (const o of offs ?? []) {
    const v = arr((o as { variant?: unknown }).variant) as
      | { id: string; sku: string; label: string | null; market_price_cents: number; active: boolean; product?: unknown }
      | undefined
    const prod = arr(v?.product) as { id: string; name: string; product_type: string; status: string } | undefined
    if (!v?.active || !prod || prod.status !== 'active') continue
    allowed.set(v.id, {
      sku: v.sku,
      name: `${prod.name}${v.label ? ` — ${v.label}` : ''}`,
      productId: prod.id,
      productType: prod.product_type,
      priceCents: v.market_price_cents,
    })
  }

  const lines: AddonLine[] = []
  for (const sel of selections) {
    const a = allowed.get(sel.variantId)
    const qty = Math.max(1, Math.floor(Number(sel.qty) || 1))
    if (!a) continue
    const price = await computeUnitPrice(
      { market_price_cents: a.priceCents, product_id: a.productId },
      { product_type: a.productType },
      { kind: 'event', eventSlug },
    )
    lines.push({ variantId: sel.variantId, sku: a.sku, name: a.name, qty, unitCents: price.unit_cents })
  }
  return lines
}

// Public list of an event's paid add-ons (event-discounted price), for the
// registration form's merch picker.
export async function listEventAddons(
  db: SupabaseClient,
  eventSlug: string,
): Promise<{ variantId: string; name: string; unitCents: number }[]> {
  const { data: offs } = await db
    .from('event_store_offerings')
    .select('variant:store_variants(id, label, market_price_cents, active, product:store_products(id, name, product_type, status))')
    .eq('event_slug', eventSlug)
    .eq('treatment', 'addon')

  const out: { variantId: string; name: string; unitCents: number }[] = []
  for (const o of offs ?? []) {
    const v = arr((o as { variant?: unknown }).variant) as
      | { id: string; label: string | null; market_price_cents: number; active: boolean; product?: unknown }
      | undefined
    const prod = arr(v?.product) as { id: string; name: string; product_type: string; status: string } | undefined
    if (!v?.active || !prod || prod.status !== 'active') continue
    const price = await computeUnitPrice(
      { market_price_cents: v.market_price_cents, product_id: prod.id },
      { product_type: prod.product_type },
      { kind: 'event', eventSlug },
    )
    out.push({ variantId: v.id, name: `${prod.name}${v.label ? ` — ${v.label}` : ''}`, unitCents: price.unit_cents })
  }
  return out
}

// Persist add-on lines as 'pending' items on the registration's event-merch order
// (called at registration time, before payment).
export async function addRegistrationAddons(
  db: SupabaseClient,
  registrationId: string,
  lines: AddonLine[],
  participantMemberId: string | null,
): Promise<void> {
  if (lines.length === 0) return
  const orderId = await ensureEventMerchOrder(db, registrationId)
  if (!orderId) return
  await db.from('store_order_items').insert(
    lines.map((l) => ({
      order_id: orderId,
      variant_id: l.variantId,
      sku: l.sku,
      name: l.name,
      qty: l.qty,
      unit_amount_cents: l.unitCents,
      line_source: 'event_addon',
      fulfillment_mode: 'batch',
      fulfillment_status: 'pending',
      participant_member_id: participantMemberId,
    })),
  )
}

// Allocate the included shirt(s) to every participant — idempotent at the item
// level so it coexists with add-ons in the same order.
export async function allocateIncludedShirts(db: SupabaseClient, registrationId: string): Promise<void> {
  const orderId = await ensureEventMerchOrder(db, registrationId)
  if (!orderId) return

  const { data: alreadyIncluded } = await db
    .from('store_order_items')
    .select('id')
    .eq('order_id', orderId)
    .eq('line_source', 'event_included')
    .limit(1)
    .maybeSingle()
  if (alreadyIncluded) return

  const { data: regRow } = await db.from('registrations').select('event_slug').eq('id', registrationId).maybeSingle()
  const eventSlug = (regRow as { event_slug?: string } | null)?.event_slug
  if (!eventSlug) return

  const offerings = await getIncludedOfferings(db, eventSlug)
  if (offerings.length === 0) return

  const { data: partRows } = await db
    .from('participants')
    .select('member_id, t_shirt_size')
    .eq('registration_id', registrationId)
  const parts = (partRows ?? []) as { member_id: string | null; t_shirt_size: string | null }[]
  if (parts.length === 0) return

  const items: Record<string, unknown>[] = []
  for (const p of parts) {
    for (const off of offerings) {
      const variant = resolveVariantForSize(off.variants, p.t_shirt_size) ?? off.fallbackVariant
      if (!variant) continue
      items.push({
        order_id: orderId,
        variant_id: variant.id,
        sku: variant.sku,
        name: `${off.productName}${variant.label ? ` — ${variant.label}` : ''}`,
        qty: 1,
        unit_amount_cents: 0,
        line_source: 'event_included',
        fulfillment_mode: 'batch',
        fulfillment_status: 'awaiting_batch',
        participant_member_id: p.member_id ?? null,
      })
    }
  }
  if (items.length > 0) await db.from('store_order_items').insert(items)
}

// On confirmation: allocate included shirts, activate paid add-ons, mark the
// event-merch order paid. Idempotent + best-effort (never breaks confirmation).
export async function finalizeRegistrationMerch(db: SupabaseClient, registrationId: string): Promise<void> {
  try {
    const orderId = await ensureEventMerchOrder(db, registrationId)
    if (!orderId) return
    await allocateIncludedShirts(db, registrationId)
    // Pending add-ons are now paid → make them eligible for the bulk batch.
    await db
      .from('store_order_items')
      .update({ fulfillment_status: 'awaiting_batch' })
      .eq('order_id', orderId)
      .eq('line_source', 'event_addon')
      .eq('fulfillment_status', 'pending')
    await db.from('store_orders').update({ status: 'paid' }).eq('id', orderId)
  } catch (err) {
    console.error('[store/event-merch] finalizeRegistrationMerch failed (non-fatal):', err)
  }
}
