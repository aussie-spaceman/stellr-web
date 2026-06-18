// Discount data access + resolution for the web store (PRD §12).
//
// Two non-stacking axes:
//   * Tier discounts — applied in the storefront based on the buyer's active
//     membership tier.
//   * Event discounts — applied to event/campaign merch; a per-event row
//     overrides the global default (mirrors the refund_policies engine).

import { supabaseServer } from '@/lib/supabase'
import type { EventDiscount, TierDiscount } from './types'

export async function listTierDiscounts(): Promise<TierDiscount[]> {
  const db = supabaseServer()
  const { data, error } = await db.from('store_tier_discounts').select('*')
  if (error) throw new Error(`listTierDiscounts: ${error.message}`)
  return (data ?? []) as TierDiscount[]
}

export async function listEventDiscounts(): Promise<EventDiscount[]> {
  const db = supabaseServer()
  const { data, error } = await db.from('store_event_discounts').select('*')
  if (error) throw new Error(`listEventDiscounts: ${error.message}`)
  return (data ?? []) as EventDiscount[]
}

export async function upsertTierDiscount(input: Partial<TierDiscount>): Promise<void> {
  const db = supabaseServer()
  const row = {
    tier_id: input.tier_id,
    scope: input.scope ?? 'all',
    product_id: input.product_id ?? null,
    category: input.category ?? null,
    percent_off: input.percent_off ?? 0,
  }
  const q = input.id
    ? db.from('store_tier_discounts').update(row).eq('id', input.id)
    : db.from('store_tier_discounts').insert(row)
  const { error } = await q
  if (error) throw new Error(`upsertTierDiscount: ${error.message}`)
}

export async function upsertEventDiscount(input: Partial<EventDiscount>): Promise<void> {
  const db = supabaseServer()
  const row = {
    scope: input.scope ?? 'global',
    event_slug: input.scope === 'event' ? input.event_slug ?? null : null,
    product_id: input.product_id ?? null,
    category: input.category ?? null,
    percent_off: input.percent_off ?? 0,
  }
  const q = input.id
    ? db.from('store_event_discounts').update(row).eq('id', input.id)
    : db.from('store_event_discounts').insert(row)
  const { error } = await q
  if (error) throw new Error(`upsertEventDiscount: ${error.message}`)
}

export async function deleteDiscount(axis: 'tier' | 'event', id: string): Promise<void> {
  const db = supabaseServer()
  const table = axis === 'tier' ? 'store_tier_discounts' : 'store_event_discounts'
  const { error } = await db.from(table).delete().eq('id', id)
  if (error) throw new Error(`deleteDiscount: ${error.message}`)
}

// --- Resolution -------------------------------------------------------------

function applies(
  row: { scope: string; product_id: string | null; category: string | null },
  productId: string,
  category: string,
): boolean {
  if (row.scope === 'product') return row.product_id === productId
  if (row.scope === 'category') return row.category === category
  return true // 'all' (tier) — global rows are filtered before this for events
}

// Best (highest) tier discount percent for a product, 0 when none.
export async function resolveTierPercent(
  tierId: string,
  productId: string,
  category: string,
): Promise<number> {
  const rows = (await listTierDiscounts()).filter((r) => r.tier_id === tierId)
  const matching = rows.filter((r) => applies(r, productId, category))
  return matching.reduce((max, r) => Math.max(max, r.percent_off), 0)
}

// Event merch percent: per-event override wins over global; within the chosen
// scope take the highest matching percent. 100 = the free included shirt.
export async function resolveEventPercent(
  eventSlug: string,
  productId: string,
  category: string,
): Promise<number> {
  const all = await listEventDiscounts()
  const eventRows = all.filter((r) => r.scope === 'event' && r.event_slug === eventSlug)
  const pool = eventRows.length > 0 ? eventRows : all.filter((r) => r.scope === 'global')
  const matching = pool.filter((r) => applies(r, productId, category))
  return matching.reduce((max, r) => Math.max(max, r.percent_off), 0)
}
