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

// An entitlement of a given kind is scoped against this offering_type.
const KIND_TO_OFFERING: Record<EntitlementKind, OfferingType | null> = {
  coaching_session: 'coaching_session',
  cohort_access: 'mentoring_cohort',
  call_series: 'call_series',
  training_access: 'training_content',
  generic: null,
}

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
 * mentoring) into the member's entitlement ledger. Keyed on the membership id so
 * webhook retries never double-grant. Called from the Stripe webhook when a
 * membership activates. ADDITIVE during transition — runs alongside the existing
 * session_credits grant until the cutover migrates consumption to this ledger.
 */
export async function grantTierAllocations(memberId: string, membershipId: string): Promise<number> {
  const db = ent()
  const tierCode = await getActiveTierCode(memberId)
  if (!tierCode) return 0

  const { data: benefits, error: bErr } = await db
    .from('tier_benefits')
    .select('id, kind, quantity, period, validity_days')
    .eq('tier_code', tierCode)
    .not('kind', 'is', null)
  if (bErr) throw new Error(`grantTierAllocations: ${bErr.message}`)

  let created = 0
  for (const b of (benefits ?? []) as TierBenefit[]) {
    if (!b.kind || !b.quantity || b.quantity <= 0) continue
    const sourceRef = `${membershipId}:${b.id}`
    const { count } = await db
      .from('entitlements')
      .select('id', { count: 'exact', head: true })
      .eq('member_id', memberId)
      .eq('source', 'tier_grant')
      .eq('source_ref', sourceRef)
    if ((count ?? 0) > 0) continue

    const expiresAt = b.validity_days
      ? new Date(Date.now() + b.validity_days * 24 * 60 * 60 * 1000).toISOString()
      : null
    const { error: iErr } = await db.from('entitlements').insert({
      member_id: memberId,
      kind: b.kind,
      scope_type: 'offering_type',
      offering_type: KIND_TO_OFFERING[b.kind],
      quantity_total: b.quantity,
      quantity_remaining: b.quantity,
      source: 'tier_grant',
      source_ref: sourceRef,
      refundable: false,
      status: 'active',
      expires_at: expiresAt,
    })
    if (iErr) throw new Error(`grantTierAllocations(insert): ${iErr.message}`)
    created += 1
  }
  return created
}
