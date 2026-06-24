// lib/pricing.ts — flat platform pricing defaults (Decision D5 of the Workshops &
// Cohorts access plan). Single-row platform_pricing table (migration 079) holds the
// flat price of any cohort / any workshop and the per-credit top-up unit prices.
// Container rows seed their one_off_price_cents / credit_cost from these at create;
// per-container columns already exist, so variable pricing later is a data edit.
import 'server-only'
import { supabaseServer } from '@/lib/supabase'
import { CREDIT_PACK_PRICE_CENTS } from '@/lib/mentoring-format'

export interface PlatformPricing {
  cohortPriceCents: number
  workshopPriceCents: number
  cohortCreditPriceCents: number
  workshopCreditPriceCents: number
}

const FALLBACK: PlatformPricing = {
  cohortPriceCents: 0,
  workshopPriceCents: 0,
  cohortCreditPriceCents: CREDIT_PACK_PRICE_CENTS,
  workshopCreditPriceCents: CREDIT_PACK_PRICE_CENTS,
}

/** Read the single platform_pricing row (falls back to sensible defaults). */
export async function getPlatformPricing(): Promise<PlatformPricing> {
  const db = supabaseServer()
  const { data } = await db
    .from('platform_pricing')
    .select('cohort_price_cents, workshop_price_cents, cohort_credit_price_cents, workshop_credit_price_cents')
    .eq('id', true)
    .maybeSingle()
  if (!data) return FALLBACK
  const r = data as {
    cohort_price_cents: number | null
    workshop_price_cents: number | null
    cohort_credit_price_cents: number | null
    workshop_credit_price_cents: number | null
  }
  return {
    cohortPriceCents: r.cohort_price_cents ?? FALLBACK.cohortPriceCents,
    workshopPriceCents: r.workshop_price_cents ?? FALLBACK.workshopPriceCents,
    cohortCreditPriceCents: r.cohort_credit_price_cents ?? FALLBACK.cohortCreditPriceCents,
    workshopCreditPriceCents: r.workshop_credit_price_cents ?? FALLBACK.workshopCreditPriceCents,
  }
}

/** Update the flat platform-pricing defaults (admin). Only provided fields change. */
export async function updatePlatformPricing(patch: Partial<PlatformPricing>): Promise<void> {
  const db = supabaseServer()
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.cohortPriceCents !== undefined) row.cohort_price_cents = Math.max(0, Math.floor(patch.cohortPriceCents))
  if (patch.workshopPriceCents !== undefined) row.workshop_price_cents = Math.max(0, Math.floor(patch.workshopPriceCents))
  if (patch.cohortCreditPriceCents !== undefined) row.cohort_credit_price_cents = Math.max(0, Math.floor(patch.cohortCreditPriceCents))
  if (patch.workshopCreditPriceCents !== undefined) row.workshop_credit_price_cents = Math.max(0, Math.floor(patch.workshopCreditPriceCents))
  await db.from('platform_pricing').update(row).eq('id', true)
}
