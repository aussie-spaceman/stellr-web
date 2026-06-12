import { supabaseServer } from '@/lib/supabase'

// Refund-rules engine. A policy is an ordered set of tiers keyed by how many
// whole days before the event the cancellation happens. Each tier may offer a
// cash percentage, a credit percentage (with a validity window), or both — when
// both are present the admin chooses at deletion time.

export interface RefundTier {
  minDaysOut: number
  cashPct: number | null
  creditPct: number | null
  creditValidityDays: number | null
}

// Mirror of the seeded global default in migration 027 — used as a fallback if
// the DB row is somehow missing.
export const DEFAULT_TIERS: RefundTier[] = [
  { minDaysOut: 90, cashPct: 100, creditPct: null, creditValidityDays: null },
  { minDaysOut: 30, cashPct: 50, creditPct: 75, creditValidityDays: 730 },
  { minDaysOut: 14, cashPct: 33, creditPct: 50, creditValidityDays: 730 },
  { minDaysOut: 0, cashPct: null, creditPct: 25, creditValidityDays: 730 },
]

export interface RefundOption {
  pct: number
  cents: number
  validityDays?: number | null
}

export interface RefundOptions {
  cash?: RefundOption
  credit?: RefundOption
}

// Resolves the effective tiers for an event: a per-event override if one exists,
// otherwise the global policy, otherwise the hard-coded default.
export async function resolvePolicy(eventSlug: string): Promise<RefundTier[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('refund_policies')
    .select('scope, event_slug, tiers')
    .or(`scope.eq.global,event_slug.eq.${eventSlug}`)

  const rows = data ?? []
  const eventRow = rows.find((r) => r.scope === 'event' && r.event_slug === eventSlug)
  const globalRow = rows.find((r) => r.scope === 'global')
  const tiers = (eventRow?.tiers ?? globalRow?.tiers) as RefundTier[] | undefined
  return Array.isArray(tiers) && tiers.length > 0 ? tiers : DEFAULT_TIERS
}

// Whole days between `now` and the event date (floored, never negative).
export function daysOut(eventDateISO: string, now: Date = new Date()): number {
  const event = new Date(eventDateISO)
  const ms = event.getTime() - now.getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

// The tier whose minDaysOut is the largest value <= the actual days-out.
export function applicableTier(tiers: RefundTier[], eventDateISO: string, now?: Date): RefundTier | null {
  const d = daysOut(eventDateISO, now)
  const sorted = [...tiers].sort((a, b) => b.minDaysOut - a.minDaysOut)
  return sorted.find((t) => d >= t.minDaysOut) ?? null
}

// Translates a tier + amount paid into concrete cash/credit options (rounded to
// whole cents).
export function computeRefundOptions(tier: RefundTier | null, paidCents: number): RefundOptions {
  if (!tier) return {}
  const opts: RefundOptions = {}
  if (tier.cashPct != null) {
    opts.cash = { pct: tier.cashPct, cents: Math.round((paidCents * tier.cashPct) / 100) }
  }
  if (tier.creditPct != null) {
    opts.credit = {
      pct: tier.creditPct,
      cents: Math.round((paidCents * tier.creditPct) / 100),
      validityDays: tier.creditValidityDays,
    }
  }
  return opts
}
