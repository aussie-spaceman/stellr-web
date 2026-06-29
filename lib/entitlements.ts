// lib/entitlements.ts — single source of truth for the member entitlements,
// pricing & credits engine (Option 3: catalog + unified ledger + pricing engine).
//
// Everything that prices, grants, books, or discounts mentoring / coaching /
// (future) training reads through THIS module, which delegates to the tested
// SQL in the `entitlements` schema (migrations 088–090). Public pages, the app,
// the admin discount console, the booking API and the Stripe webhook all call
// these helpers — so a change in the admin `discounts` table reflects everywhere.
//
// Money is integer cents. Server-only (service-role); never import from a client
// component. RLS denies anon/authenticated, so reads MUST go through here.
import 'server-only'
import { supabaseServer } from '@/lib/supabase'

// All entitlements objects live in the `entitlements` Postgres schema, exposed
// to PostgREST in migration 090. `ent()` returns a schema-scoped client.
function ent() {
  return supabaseServer().schema('entitlements')
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type OfferingType = 'coaching_session' | 'mentoring_cohort' | 'call_series' | 'training_content'
export type EntitlementKind = 'coaching_session' | 'cohort_access' | 'call_series' | 'training_access' | 'generic'
export type DiscountKind = 'tier' | 'coupon'
export type DiscountType = 'percent' | 'fixed'


export interface Quote {
  includedAvailable: boolean
  baseCents: number
  tierDiscountPct: number
  afterTierCents: number
  couponCode: string | null
  couponApplied: boolean
  couponDiscountCents: number
  netCents: number
  creditAvailableCents: number
  payableCents: number
}

export interface Discount {
  id: string
  kind: DiscountKind
  tier_code: string | null
  code: string | null
  label: string | null
  discount_type: DiscountType
  percent: number | null
  amount_cents: number | null
  applies_to: OfferingType | null
  valid_from: string | null
  valid_to: string | null
  max_redemptions: number | null
  times_redeemed: number
  is_active: boolean
  updated_at?: string
}

export interface Offering {
  id: string
  type: OfferingType
  title: string
  capacity: number | null
  seats_taken: number
  status: 'open' | 'full' | 'cancelled' | 'completed'
  starts_at: string | null
}

// ── Pricing (read) ──────────────────────────────────────────────────────────────

/**
 * What will this offering cost this member right now? Returns the included/free
 * path or base → tier discount → coupon → account-credit waterfall. An
 * invalid/expired/exhausted coupon is silently ignored (couponApplied=false) so
 * the UI can show "code not valid" without the quote failing.
 */
export async function getQuote(memberId: string, offeringId: string, coupon?: string | null): Promise<Quote> {
  const { data, error } = await ent().rpc('fn_quote', {
    p_member: memberId,
    p_offering: offeringId,
    p_coupon: coupon ?? null,
  })
  if (error) throw new Error(`getQuote: ${error.message}`)
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined
  if (!r) throw new Error('getQuote: no row returned')
  return {
    includedAvailable: Boolean(r.included_available),
    baseCents: Number(r.base_cents),
    tierDiscountPct: Number(r.tier_discount_pct),
    afterTierCents: Number(r.after_tier_cents),
    couponCode: (r.coupon_code as string | null) ?? null,
    couponApplied: Boolean(r.coupon_applied),
    couponDiscountCents: Number(r.coupon_discount_cents),
    netCents: Number(r.net_cents),
    creditAvailableCents: Number(r.credit_available),
    payableCents: Number(r.payable_cents),
  }
}

/** Active tier code for a member (read from member_memberships), or null. */
export async function getActiveTierCode(memberId: string): Promise<string | null> {
  const { data, error } = await ent().rpc('fn_active_tier', { p_member: memberId })
  if (error) throw new Error(`getActiveTierCode: ${error.message}`)
  return (data as string | null) ?? null
}

/** Remaining included allocation of a kind for a member. */
export async function getAllocationBalance(
  memberId: string,
  kind: EntitlementKind,
  offeringType?: OfferingType,
): Promise<number> {
  const { data, error } = await ent().rpc('fn_allocation_balance', {
    p_member: memberId,
    p_kind: kind,
    p_offering: null,
    p_offering_type: offeringType ?? null,
  })
  if (error) throw new Error(`getAllocationBalance: ${error.message}`)
  return Number(data ?? 0)
}

/** A member's store-credit balance (cents). */
export async function getCreditBalanceCents(memberId: string): Promise<number> {
  const { data, error } = await ent().rpc('fn_credit_balance', { p_member: memberId })
  if (error) throw new Error(`getCreditBalanceCents: ${error.message}`)
  return Number(data ?? 0)
}

export interface BookingRow {
  id: string
  offering_id: string
  status: 'reserved' | 'attended' | 'no_show' | 'cancelled'
  amount_charged_cents: number
  created_at: string
}

export interface EntitlementSummary {
  coachingBalance: number
  mentoringBalance: number
  creditCents: number
  bookings: BookingRow[]
}

/** A member's dashboard view: included balances, store credit, recent bookings. */
export async function getMemberEntitlementSummary(memberId: string): Promise<EntitlementSummary> {
  const [coachingBalance, mentoringBalance, creditCents] = await Promise.all([
    getAllocationBalance(memberId, 'coaching_session', 'coaching_session'),
    getAllocationBalance(memberId, 'cohort_access', 'mentoring_cohort'),
    getCreditBalanceCents(memberId),
  ])
  const { data, error } = await ent()
    .from('bookings')
    .select('id, offering_id, status, amount_charged_cents, created_at')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) throw new Error(`getMemberEntitlementSummary: ${error.message}`)
  return { coachingBalance, mentoringBalance, creditCents, bookings: (data ?? []) as BookingRow[] }
}

// ── Offerings (read) ────────────────────────────────────────────────────────────

export async function listOfferings(type?: OfferingType): Promise<Offering[]> {
  let q = ent().from('offerings').select('id, type, title, capacity, seats_taken, status, starts_at').eq('status', 'open')
  if (type) q = q.eq('type', type)
  const { data, error } = await q.order('starts_at', { ascending: true, nullsFirst: false })
  if (error) throw new Error(`listOfferings: ${error.message}`)
  return (data ?? []) as Offering[]
}

// ── Tiers (canonical) ───────────────────────────────────────────────────────────

export interface Tier {
  code: string
  name: string
  is_free: boolean
  stripe_price_id: string | null
  stripe_price_id_monthly: string | null
}

export async function listTiers(): Promise<Tier[]> {
  const { data, error } = await ent().from('tiers').select('code, name, is_free, stripe_price_id, stripe_price_id_monthly').order('name')
  if (error) throw new Error(`listTiers: ${error.message}`)
  return (data ?? []) as Tier[]
}

// ── Discounts admin (read + write) — the single source of truth ────────────────

export async function listDiscounts(kind?: DiscountKind): Promise<Discount[]> {
  let q = ent().from('discounts').select('*')
  if (kind) q = q.eq('kind', kind)
  const { data, error } = await q.order('kind').order('updated_at', { ascending: false })
  if (error) throw new Error(`listDiscounts: ${error.message}`)
  return (data ?? []) as Discount[]
}

export type DiscountInput = Partial<Omit<Discount, 'id' | 'times_redeemed' | 'updated_at'>> & {
  kind: DiscountKind
  discount_type: DiscountType
}

/** Insert (no id) or update (id) a discount/coupon row. Validates shape. */
export async function upsertDiscount(input: DiscountInput & { id?: string }): Promise<Discount> {
  if (input.kind === 'tier' && !input.tier_code) throw new Error('Tier discount requires tier_code')
  if (input.kind === 'coupon' && !input.code) throw new Error('Coupon requires a code')
  if (input.discount_type === 'percent' && input.percent == null) throw new Error('Percent discount requires percent')
  if (input.discount_type === 'fixed' && input.amount_cents == null) throw new Error('Fixed discount requires amount_cents')

  const row: Record<string, unknown> = {
    kind: input.kind,
    tier_code: input.kind === 'tier' ? input.tier_code : null,
    code: input.kind === 'coupon' ? input.code : null,
    label: input.label ?? null,
    discount_type: input.discount_type,
    percent: input.discount_type === 'percent' ? input.percent : null,
    amount_cents: input.discount_type === 'fixed' ? input.amount_cents : null,
    applies_to: input.applies_to ?? null,
    valid_from: input.valid_from ?? null,
    valid_to: input.valid_to ?? null,
    max_redemptions: input.max_redemptions ?? null,
    is_active: input.is_active ?? true,
  }

  const db = ent()
  if (input.id) {
    const { data, error } = await db.from('discounts').update(row).eq('id', input.id).select('*').single()
    if (error) throw new Error(`upsertDiscount(update): ${error.message}`)
    return data as Discount
  }
  const { data, error } = await db.from('discounts').insert(row).select('*').single()
  if (error) throw new Error(`upsertDiscount(insert): ${error.message}`)
  return data as Discount
}

export async function deleteDiscount(id: string): Promise<void> {
  const { error } = await ent().from('discounts').delete().eq('id', id)
  if (error) throw new Error(`deleteDiscount: ${error.message}`)
}

// ── Tier allocations admin (free coaching / mentoring quantities) ───────────────

export interface TierBenefit {
  id: string
  tier_code: string
  kind: EntitlementKind | null
  quantity: number | null
  period: 'one_off' | 'monthly' | 'quarterly' | 'per_term'
  validity_days: number | null
}

export async function listTierBenefits(): Promise<TierBenefit[]> {
  const { data, error } = await ent().from('tier_benefits').select('id, tier_code, kind, quantity, period, validity_days').not('kind', 'is', null)
  if (error) throw new Error(`listTierBenefits: ${error.message}`)
  return (data ?? []) as TierBenefit[]
}

export async function setTierAllocationQuantity(id: string, quantity: number): Promise<void> {
  const { error } = await ent().from('tier_benefits').update({ quantity: Math.max(0, Math.floor(quantity)) }).eq('id', id)
  if (error) throw new Error(`setTierAllocationQuantity: ${error.message}`)
}

/** Coaching allowance (tier_benefits coaching_session) keyed by membership_tier_id —
 *  for the admin coaching-tier display (replaces the session_entitlements read). */
export async function getCoachingAllocationByTier(): Promise<Map<string, { quantity: number; validityDays: number | null }>> {
  const [{ data: tiers }, { data: bens }] = await Promise.all([
    ent().from('tiers').select('membership_tier_id, code'),
    ent().from('tier_benefits').select('tier_code, quantity, validity_days').eq('kind', 'coaching_session'),
  ])
  const byCode = new Map(
    ((bens ?? []) as Array<{ tier_code: string; quantity: number | null; validity_days: number | null }>).map((b) => [b.tier_code, b]),
  )
  const out = new Map<string, { quantity: number; validityDays: number | null }>()
  for (const t of (tiers ?? []) as Array<{ membership_tier_id: string; code: string }>) {
    const b = byCode.get(t.code)
    if (b) out.set(t.membership_tier_id, { quantity: b.quantity ?? 0, validityDays: b.validity_days ?? null })
  }
  return out
}

/** Upsert a tier's coaching allowance into tier_benefits by (tier_code, kind) —
 *  the admin coaching editor (replaces the session_entitlements upsert). */
export async function setTierCoachingAllocation(tierId: string, freeSessions: number, validityDays = 365): Promise<void> {
  const { data: t } = await ent().from('tiers').select('code').eq('membership_tier_id', tierId).maybeSingle()
  const code = (t as { code?: string } | null)?.code
  if (!code) throw new Error('setTierCoachingAllocation: no tier code for membership_tier ' + tierId)
  const qty = Math.max(0, Math.floor(freeSessions))
  const { data: existing } = await ent()
    .from('tier_benefits')
    .select('id')
    .eq('tier_code', code)
    .eq('kind', 'coaching_session')
    .maybeSingle()
  if (existing) {
    const { error } = await ent().from('tier_benefits').update({ quantity: qty, validity_days: validityDays }).eq('id', (existing as { id: string }).id)
    if (error) throw new Error(`setTierCoachingAllocation: ${error.message}`)
  } else {
    const { error } = await ent().from('tier_benefits').insert({ tier_code: code, kind: 'coaching_session', quantity: qty, period: 'one_off', validity_days: validityDays })
    if (error) throw new Error(`setTierCoachingAllocation: ${error.message}`)
  }
}

/** Stripe price id for buying an EXTRA session at the member's tier (tier_benefits.
 *  extra_stripe_price_id; replaces the session_entitlements lookup). Returns the
 *  first configured price across the member's active tiers, or null. */
export async function getTierExtraPriceId(tierIds: string[], kind: 'coaching_session' | 'cohort_access'): Promise<string | null> {
  if (!tierIds.length) return null
  const { data: tiers } = await ent().from('tiers').select('code').in('membership_tier_id', tierIds)
  const codes = ((tiers ?? []) as Array<{ code: string }>).map((t) => t.code)
  if (!codes.length) return null
  const { data } = await ent().from('tier_benefits').select('extra_stripe_price_id').eq('kind', kind).in('tier_code', codes)
  return ((data ?? []) as Array<{ extra_stripe_price_id: string | null }>).map((d) => d.extra_stripe_price_id).find((p): p is string => !!p) ?? null
}

// ── Booking (write) — server-side; called from APIs / the webhook ──────────────

/** Consume an included allocation for a free booking. Returns the booking id. */
export async function bookFromAllocation(memberId: string, offeringId: string, participantId?: string | null): Promise<string> {
  const { data, error } = await ent().rpc('fn_book_from_allocation', {
    p_member: memberId,
    p_offering: offeringId,
    p_participant: participantId ?? null,
  })
  if (error) throw new Error(`bookFromAllocation: ${error.message}`)
  return data as string
}

/** Record a paid booking after Stripe confirms payment. Returns the booking id. */
export async function confirmPaidBooking(args: {
  memberId: string
  offeringId: string
  stripePaymentId: string
  amountChargedCents: number
  creditAppliedCents: number
  participantId?: string | null
}): Promise<string> {
  const { data, error } = await ent().rpc('fn_confirm_paid_booking', {
    p_member: args.memberId,
    p_offering: args.offeringId,
    p_stripe_payment: args.stripePaymentId,
    p_amount_charged_cents: args.amountChargedCents,
    p_credit_applied_cents: args.creditAppliedCents,
    p_participant: args.participantId ?? null,
  })
  if (error) throw new Error(`confirmPaidBooking: ${error.message}`)
  return data as string
}

/** Record that a coupon was redeemed on a booking (increments times_redeemed). */
export async function redeemCoupon(code: string, memberId: string, bookingId: string | null, amountCents: number): Promise<void> {
  const { error } = await ent().rpc('fn_redeem_coupon', {
    p_code: code,
    p_member: memberId,
    p_booking: bookingId,
    p_amount_cents: amountCents,
  })
  if (error) throw new Error(`redeemCoupon: ${error.message}`)
}

// ── Grant-on-activation — materialize a tier's allocations into the ledger ──────

/**
 * Idempotently materialise the active tier's allocation rows (free coaching /
 * mentoring) into the member's entitlement ledger for the current period.
 * Delegates to the tested SQL (entitlements.fn_grant_member_benefits, migration
 * 091), keyed on (membership, benefit, period) so webhook retries and overlapping
 * cron ticks never double-grant. Returns the number of new lots created.
 * ADDITIVE during transition — runs alongside the existing session_credits grant
 * until the cutover migrates consumption to this ledger.
 */
export async function grantTierAllocations(membershipId: string): Promise<number> {
  const { data, error } = await ent().rpc('fn_grant_member_benefits', {
    p_membership: membershipId,
    p_as_of: new Date().toISOString(),
  })
  if (error) throw new Error(`grantTierAllocations: ${error.message}`)
  return Number(data ?? 0)
}

/**
 * Ensure the member's active memberships have materialised their tier allocations into
 * the ledger (idempotent). Mirrors the old "sync allowance first, then read balance"
 * pattern so a balance read is always accurate even before the daily cron runs.
 */
export async function ensureMemberGrants(memberId: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0]
  const { data: ms } = await supabaseServer()
    .from('member_memberships')
    .select('id, expires_at')
    .eq('member_id', memberId)
    .eq('renewal_status', 'active')
  for (const m of (ms ?? []) as Array<{ id: string; expires_at: string | null }>) {
    if (m.expires_at && m.expires_at < today) continue
    await grantTierAllocations(m.id).catch(() => {})
  }
}

/** {remaining, used, total} balance for one allocation kind (sums the member's lots). */
export async function getKindBalance(
  memberId: string,
  kind: EntitlementKind,
): Promise<{ remaining: number; used: number; total: number }> {
  const { data } = await ent()
    .from('entitlements')
    .select('quantity_total, quantity_remaining')
    .eq('member_id', memberId)
    .eq('kind', kind)
    .in('status', ['active', 'consumed'])
  let total = 0
  let remaining = 0
  for (const r of (data ?? []) as Array<{ quantity_total: number; quantity_remaining: number }>) {
    total += r.quantity_total
    remaining += r.quantity_remaining
  }
  return { remaining, used: total - remaining, total }
}

/**
 * Balance split by GRANTED (tier_grant / admin / auto = "included") vs PURCHASED
 * (paid extras). Lets a display show "X free left" + "Y purchased" while the
 * booking engine still draws from the combined pool. granted.{total,remaining,used}
 * are the included allowance; purchasedRemaining is bought-and-unused.
 */
export async function getKindBalanceSplit(
  memberId: string,
  kind: EntitlementKind,
): Promise<{ granted: { total: number; remaining: number; used: number }; purchasedRemaining: number }> {
  const { data } = await ent()
    .from('entitlements')
    .select('quantity_total, quantity_remaining, source')
    .eq('member_id', memberId)
    .eq('kind', kind)
    .in('status', ['active', 'consumed'])
  let gTotal = 0
  let gRemaining = 0
  let purchasedRemaining = 0
  for (const r of (data ?? []) as Array<{ quantity_total: number; quantity_remaining: number; source: string }>) {
    if (r.source === 'purchased') {
      purchasedRemaining += r.quantity_remaining
    } else {
      gTotal += r.quantity_total
      gRemaining += r.quantity_remaining
    }
  }
  return { granted: { total: gTotal, remaining: gRemaining, used: gTotal - gRemaining }, purchasedRemaining }
}

/**
 * Grant a PURCHASED allocation lot into the ledger (paid extra-session topups).
 * One refundable lot of `quantity`, idempotent on the Stripe session id (webhook
 * retries safe). Returns rows granted (the quantity, or 0 if already granted).
 */
export async function grantPurchasedLot(
  memberId: string,
  kind: 'coaching_session' | 'cohort_access',
  quantity: number,
  stripeSessionId: string,
): Promise<number> {
  const { data, error } = await ent().rpc('fn_grant_purchased', {
    p_member: memberId,
    p_kind: kind,
    p_quantity: quantity,
    p_stripe_session: stripeSessionId,
    p_expires_at: null,
  })
  if (error) throw new Error(`grantPurchasedLot: ${error.message}`)
  return Number(data ?? 0)
}

/**
 * Get-or-create the OPEN mentoring_cohort offering bound to a cohort (capacity null
 * = no cap, preserving the pre-cutover no-rejection behaviour). Mentoring offerings
 * aren't auto-synced on cohort creation, so the enroll/purchase paths ensure one
 * here. Returns the offering id (null only if the cohort row is missing).
 */
export async function getOrCreateCohortOffering(cohortId: string): Promise<string | null> {
  const { data: off } = await ent()
    .from('offerings')
    .select('id')
    .eq('cohort_id', cohortId)
    .eq('type', 'mentoring_cohort')
    .maybeSingle()
  if (off) return (off as { id: string }).id
  const { data: c } = await supabaseServer()
    .from('mentoring_cohorts')
    .select('name')
    .eq('id', cohortId)
    .maybeSingle()
  if (!c) return null
  const { data: created } = await ent()
    .from('offerings')
    .insert({ type: 'mentoring_cohort', cohort_id: cohortId, title: (c as { name?: string }).name ?? 'Mentoring cohort', status: 'open' })
    .select('id')
    .maybeSingle()
  return (created as { id: string } | null)?.id ?? null
}

/** {type, cohortId} an offering points at — for post-booking rostering decisions. */
export async function getOfferingTarget(offeringId: string): Promise<{ type: string; cohortId: string | null } | null> {
  const { data } = await ent().from('offerings').select('type, cohort_id').eq('id', offeringId).maybeSingle()
  if (!data) return null
  const o = data as { type: string; cohort_id: string | null }
  return { type: o.type, cohortId: o.cohort_id }
}

/**
 * Book a mentoring cohort from the member's included allocation (draws the cohort's
 * session count). Ensures the cohort's offering exists (so the booking is recorded
 * and refundable on cancellation). Returns true if booked from allocation, false
 * when there's no offering or no allocation left (caller then routes to payment).
 */
export async function bookCohortFromAllocation(memberId: string, cohortId: string): Promise<boolean> {
  const offeringId = await getOrCreateCohortOffering(cohortId)
  if (!offeringId) return false
  try {
    await bookFromAllocation(memberId, offeringId)
    return true
  } catch {
    return false
  }
}

/**
 * Cohort/workshop cancellation refund. Restores drawn ALLOCATIONS (free/included
 * sessions) back to the entitlements ledger, and refunds PAID bookings to the
 * GENERAL credit system (public.account_credits — redeemable at membership checkout,
 * shown in billing) so a member keeps one spendable, visible balance (David, #3).
 * Replaces the session_credits-scanning refundCohortMembers / refundWorkshop. No-op
 * when the cohort has no offering.
 */
export async function cancelCohortViaLedger(cohortId: string): Promise<void> {
  const db = supabaseServer()
  const { data: cohort } = await db
    .from('mentoring_cohorts')
    .select('name, container_type')
    .eq('id', cohortId)
    .maybeSingle()
  const ct = (cohort as { container_type?: string } | null)?.container_type ?? ''
  const isCoaching = ct === 'coaching' || ct === 'workshop'
  const label = (cohort as { name?: string } | null)?.name ?? (isCoaching ? 'a coaching workshop' : 'a mentoring cohort')
  const sourceType = isCoaching ? 'coaching_workshop_refund' : 'mentoring_cohort_refund'

  const { data: offs } = await ent().from('offerings').select('id').eq('cohort_id', cohortId)
  for (const o of (offs ?? []) as Array<{ id: string }>) {
    // Collect paid bookings BEFORE cancellation (fn_cancel_cohort marks them cancelled).
    const { data: paid } = await ent()
      .from('bookings')
      .select('member_id, amount_charged_cents, credit_applied_cents')
      .eq('offering_id', o.id)
      .eq('status', 'reserved')
    const toRefund = ((paid ?? []) as Array<{ member_id: string; amount_charged_cents: number | null; credit_applied_cents: number | null }>)
      .map((b) => ({ memberId: b.member_id, cents: (b.amount_charged_cents ?? 0) + (b.credit_applied_cents ?? 0) }))
      .filter((x) => x.cents > 0)

    // Restore allocations + cancel bookings/offering (paid arm is a no-op in SQL now).
    const { error } = await ent().rpc('fn_cancel_cohort', { p_offering: o.id })
    if (error) throw new Error(`cancelCohortViaLedger: ${error.message}`)

    // Issue general account credit for each paid booking.
    for (const r of toRefund) {
      await db.from('account_credits').insert({
        member_id: r.memberId,
        currency: 'usd',
        amount_cents: r.cents,
        remaining_cents: r.cents,
        source_type: sourceType,
        reason: `Account credit for cancelled ${isCoaching ? 'coaching workshop' : 'cohort'}: ${label}`,
      })
    }
  }
}

/**
 * Book a single coaching session from the member's included allocation (draws 1
 * `coaching_session`). Coaching has no pre-synced offering, so get-or-create an
 * open `coaching_session` offering bound to the coaching container (one per
 * coachee/coach pair) and draw against it. Returns true if booked from
 * allocation, false when there's no offering or no allocation left (caller then
 * routes to a purchased extra).
 */
export async function bookCoachingSessionFromAllocation(memberId: string, containerId: string): Promise<boolean> {
  let offeringId: string | null = null
  const { data: off } = await ent()
    .from('offerings')
    .select('id')
    .eq('cohort_id', containerId)
    .eq('type', 'coaching_session')
    .eq('status', 'open')
    .maybeSingle()
  if (off) {
    offeringId = (off as { id: string }).id
  } else {
    const { data: created } = await ent()
      .from('offerings')
      .insert({ type: 'coaching_session', cohort_id: containerId, title: 'Coaching session', status: 'open' })
      .select('id')
      .maybeSingle()
    offeringId = (created as { id: string } | null)?.id ?? null
  }
  if (!offeringId) return false
  try {
    await bookFromAllocation(memberId, offeringId)
    return true
  } catch {
    return false
  }
}

/**
 * Idempotently grant an ad-hoc allocation lot (rule-based / admin grant) into the
 * ledger — the Phase-4 replacement for credits.grantCredits. One lot of `quantity`,
 * scoped to the kind's offering type, never-expiring unless `expiresAt` is given.
 * Idempotent on (member, kind, source='admin', sourceRef). Returns rows granted
 * (the quantity, or 0 if this sourceRef was already granted).
 */
export async function grantAdhocEntitlement(
  memberId: string,
  kind: 'coaching_session' | 'cohort_access',
  quantity: number,
  sourceRef: string,
  expiresAt?: string | null,
): Promise<number> {
  const { data, error } = await ent().rpc('fn_grant_adhoc', {
    p_member: memberId,
    p_kind: kind,
    p_quantity: quantity,
    p_source_ref: sourceRef,
    p_expires_at: expiresAt ?? null,
  })
  if (error) throw new Error(`grantAdhocEntitlement: ${error.message}`)
  return Number(data ?? 0)
}

/**
 * Refund-on-cancel for a coaching session: release one reserved *included* booking
 * on the member's coaching offering, restoring +1 to its lot. Returns true if a
 * booking was released (false when there's no offering or no reserved included
 * booking — e.g. the session was a paid extra). Mirrors getCoachingAllowance's
 * ledger-as-source-of-truth so a cancelled session frees the allowance again.
 */
export async function releaseCoachingBooking(memberId: string, containerId: string): Promise<boolean> {
  const { data: off } = await ent()
    .from('offerings')
    .select('id')
    .eq('cohort_id', containerId)
    .eq('type', 'coaching_session')
    .maybeSingle()
  if (!off) return false
  const { data, error } = await ent().rpc('fn_release_one_booking', {
    p_member: memberId,
    p_offering: (off as { id: string }).id,
  })
  if (error) return false
  return data as boolean
}

/**
 * Display label for the active tier that grants coaching (the most generous one),
 * plus its validity window. Counts come from the ledger (getKindBalance); this is
 * purely for "Included with your {tierName} membership" and the period window.
 */
export async function getCoachingTierLabel(
  activeTierIds: string[],
): Promise<{ tierName: string | null; validityDays: number }> {
  if (activeTierIds.length === 0) return { tierName: null, validityDays: 365 }
  const { data: tiers } = await ent()
    .from('tiers')
    .select('code, name, membership_tier_id')
    .in('membership_tier_id', activeTierIds)
  const rows = (tiers ?? []) as Array<{ code: string; name: string | null }>
  if (rows.length === 0) return { tierName: null, validityDays: 365 }
  const { data: benes } = await ent()
    .from('tier_benefits')
    .select('tier_code, quantity, validity_days')
    .eq('kind', 'coaching_session')
    .in('tier_code', rows.map((t) => t.code))
  let best: { tier_code: string; quantity: number; validity_days: number | null } | null = null
  for (const b of (benes ?? []) as Array<{ tier_code: string; quantity: number; validity_days: number | null }>) {
    if (!best || b.quantity > best.quantity) best = b
  }
  if (!best) return { tierName: null, validityDays: 365 }
  return {
    tierName: rows.find((t) => t.code === best!.tier_code)?.name ?? null,
    validityDays: best.validity_days ?? 365,
  }
}

/** Daily cron: re-grant per-period allowances + expire lapsed grants. */
export async function runEntitlementsLifecycle(): Promise<{ granted: number; expired: number }> {
  const db = ent()
  const [{ data: granted, error: gErr }, { data: expired, error: eErr }] = await Promise.all([
    db.rpc('fn_regrant_periodic'),
    db.rpc('fn_expire_lapsed_grants'),
  ])
  if (gErr) throw new Error(`runEntitlementsLifecycle(regrant): ${gErr.message}`)
  if (eErr) throw new Error(`runEntitlementsLifecycle(expire): ${eErr.message}`)
  return { granted: Number(granted ?? 0), expired: Number(expired ?? 0) }
}
