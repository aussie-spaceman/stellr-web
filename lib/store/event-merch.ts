// Event-merchandise allocation for the web store (PRD §12, Phase 3).
//
// When a registration is confirmed, every participant is allocated the event's
// "included" shirt at $0, sized from their t-shirt size. These are batch-mode
// line items (fulfillment_status='awaiting_batch') that the Event Manager later
// rolls into one bulk Printful order shipped to the venue (Phase 4). Paid add-ons
// and educator bulk-buys are a separate increment.

import type { SupabaseClient } from '@supabase/supabase-js'

const arr = <T>(x: T | T[] | null | undefined): T | undefined =>
  Array.isArray(x) ? x[0] : (x ?? undefined)

// Normalise a size for matching: lowercase, trim, drop parenthetical suffixes
// e.g. "3XL (or larger)" -> "3xl".
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
// Prefers an explicit options.size; falls back to an exact size token in the
// label ("Black / L" matches "L", not "XL"). Returns null if nothing matches.
export function resolveVariantForSize(variants: VariantLite[], size: unknown): VariantLite | null {
  const s = normSize(size)
  if (!s) return null
  for (const v of variants) {
    if (normSize(v.options?.size) === s && v.options?.size) return v
  }
  for (const v of variants) {
    const tokens = String(v.label ?? '').toLowerCase().split(/[/,]/).map((t) => normSize(t))
    if (tokens.includes(s)) return v
  }
  return null
}

interface IncludedOffering {
  offeringId: string
  productId: string
  productName: string
  variants: VariantLite[]
  fallbackVariant: VariantLite | null // the variant the admin picked, used when size can't be matched
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
      offeringId: (o as { id: string }).id,
      productId,
      productName: (product as { name?: string } | null)?.name ?? 'Event shirt',
      variants: vlist,
      fallbackVariant: vlist.find((x) => x.id === v?.id) ?? vlist[0] ?? null,
    })
  }
  return result
}

// Allocate the included shirt(s) to every participant of a confirmed
// registration. Idempotent (one event-merch order per registration) and
// best-effort — callers wrap it so it can never break confirmation.
export async function allocateIncludedShirts(db: SupabaseClient, registrationId: string): Promise<void> {
  try {
    const { data: existing } = await db
      .from('store_orders')
      .select('id')
      .eq('registration_id', registrationId)
      .eq('channel', 'event_registration')
      .maybeSingle()
    if (existing) return // already allocated

    const { data: regRow } = await db
      .from('registrations')
      .select('event_slug, teacher_member_id, teacher_email')
      .eq('id', registrationId)
      .maybeSingle()
    const reg = regRow as { event_slug: string | null; teacher_member_id: string | null; teacher_email: string | null } | null
    if (!reg?.event_slug) return

    const offerings = await getIncludedOfferings(db, reg.event_slug)
    if (offerings.length === 0) return // event has no included merch — nothing to do

    const { data: partRows } = await db
      .from('participants')
      .select('id, member_id, t_shirt_size')
      .eq('registration_id', registrationId)
    const parts = (partRows ?? []) as { id: string; member_id: string | null; t_shirt_size: string | null }[]
    if (parts.length === 0) return

    const memberId = reg.teacher_member_id ?? parts.find((p) => p.member_id)?.member_id ?? null
    const { data: orderRow, error: orderErr } = await db
      .from('store_orders')
      .insert({
        member_id: memberId,
        email: reg.teacher_email ?? '',
        status: 'paid', // included = already covered by the event fee; no charge
        channel: 'event_registration',
        event_slug: reg.event_slug,
        registration_id: registrationId,
        subtotal_cents: 0,
        discount_cents: 0,
        total_cents: 0,
      })
      .select('id')
      .single()
    if (orderErr || !orderRow) return
    const orderId = (orderRow as { id: string }).id

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
  } catch (err) {
    console.error('[store/event-merch] allocateIncludedShirts failed (non-fatal):', err)
  }
}
