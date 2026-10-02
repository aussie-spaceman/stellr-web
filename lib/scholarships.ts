import { randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

// Scholarships: an application, an admin decision, and — once offered — the
// student's progress through the ordinary registration path.
// Plan: docs/PLAN-scholarship-offers-2026-10-02.md.
//
// Pure helpers live here (levels, money, stage, coupon lookup). The offer
// itself, which writes rows and sends email, is lib/scholarship-offer.ts.

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

// ── Levels ────────────────────────────────────────────────────────────────────
// Browser-safe (no node imports), so the admin review panel can use them.
export {
  SCHOLARSHIP_LEVELS,
  isScholarshipPercent,
  scholarshipCode,
  discountedCents,
  formatUsd,
  type ScholarshipPercent,
  scholarshipStage,
  stageAccepted,
  STAGE_LABEL,
  STAGE_LABEL_MEMBER,
  type ScholarshipDecision,
  type ScholarshipStage,
  type StageInputs,
} from '@/lib/scholarship-levels'
import {
  SCHOLARSHIP_LEVELS,
  discountedCents,
  scholarshipCode,
  scholarshipStage,
  type ScholarshipDecision,
  type ScholarshipPercent,
  type ScholarshipStage,
} from '@/lib/scholarship-levels'

// ── Records ───────────────────────────────────────────────────────────────────

export interface ScholarshipApplication {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string | null
  school: string | null
  brief: string
  activity: string | null
  event_slug: string | null
  event_title: string | null
  member_id: string | null
  status: ScholarshipDecision
  percent_off: number | null
  registration_id: string | null
  offer_token: string | null
  reviewed_by: string | null
  reviewed_by_name: string | null
  reviewed_at: string | null
  offered_at: string | null
  offer_emails_sent_at: string | null
  admin_notes: string | null
  source: 'website' | 'backfill'
  /** The registration was already paid when the offer was made (retrospective case). */
  registration_paid_at_offer: boolean
  created_at: string
  updated_at: string
}

export const SCHOLARSHIP_COLUMNS =
  'id, first_name, last_name, email, phone, school, brief, activity, event_slug, event_title, member_id, status, percent_off, registration_id, offer_token, reviewed_by, reviewed_by_name, reviewed_at, offered_at, offer_emails_sent_at, admin_notes, source, registration_paid_at_offer, created_at, updated_at'

export function mintOfferToken(): string {
  return randomBytes(32).toString('hex')
}

export function isOfferToken(s: unknown): s is string {
  return typeof s === 'string' && /^[a-f0-9]{64}$/.test(s)
}

/** Email 2: the ordinary registration form, carrying the offer. */
export function scholarshipRegisterUrl(eventSlug: string, token: string): string {
  return `${SITE_URL}/register/${eventSlug}/individual?scholarship=${token}`
}

/** Email 3 and the account page: one page that always knows the next step. */
export function scholarshipOfferUrl(token: string): string {
  return `${SITE_URL}/scholarship/offer/${token}`
}

export interface ScholarshipWithStage extends ScholarshipApplication {
  stage: ScholarshipStage
  registration_status: string | null
  /** The reimbursement for an already-paid student (event_refunds kind='scholarship'). */
  refund: { type: string; cents: number } | null
}

/**
 * Attaches `stage` to each application, reading the linked registrations and
 * their check-ins in two queries.
 */
export async function withStages(
  db: SupabaseClient,
  apps: ScholarshipApplication[],
): Promise<ScholarshipWithStage[]> {
  const regIds = [...new Set(apps.map((a) => a.registration_id).filter((x): x is string => !!x))]
  const regStatus = new Map<string, string>()
  const checkedIn = new Set<string>()
  const refundByReg = new Map<string, { type: string; cents: number }>()
  if (regIds.length > 0) {
    const [{ data: regs }, { data: parts }, { data: refunds }] = await Promise.all([
      db.from('registrations').select('id, status').in('id', regIds),
      db.from('participants').select('registration_id').in('registration_id', regIds).not('checked_in_at', 'is', null),
      db.from('event_refunds').select('registration_id, refund_type, refund_cents').in('registration_id', regIds).eq('kind', 'scholarship'),
    ])
    for (const r of (regs ?? []) as { id: string; status: string }[]) regStatus.set(r.id, r.status)
    for (const p of (parts ?? []) as { registration_id: string }[]) checkedIn.add(p.registration_id)
    for (const f of (refunds ?? []) as { registration_id: string; refund_type: string; refund_cents: number | null }[]) {
      // A failed card refund (manual_required) is superseded by a later success.
      const prev = refundByReg.get(f.registration_id)
      if (!prev || prev.type === 'manual_required' || prev.type === 'none') {
        refundByReg.set(f.registration_id, { type: f.refund_type, cents: f.refund_cents ?? 0 })
      }
    }
  }
  return apps.map((a) => {
    const status = a.registration_id ? regStatus.get(a.registration_id) ?? null : null
    return {
      ...a,
      registration_status: status,
      refund: (a.registration_id && refundByReg.get(a.registration_id)) || null,
      stage: scholarshipStage({
        status: a.status,
        registration: status ? { status } : null,
        checkedIn: !!a.registration_id && checkedIn.has(a.registration_id),
      }),
    }
  })
}

// ── Lookups ───────────────────────────────────────────────────────────────────

/**
 * A member's scholarship history, newest first: applications linked to them,
 * plus any made under their email before they were linked.
 */
export async function listMemberScholarships(
  db: SupabaseClient,
  member: { id: string; email: string | null },
): Promise<ScholarshipWithStage[]> {
  const filters = [`member_id.eq.${member.id}`]
  // Quoted: '.' and '@' are reserved in PostgREST's filter syntax.
  if (member.email) filters.push(`email.ilike."${member.email.trim().toLowerCase().replace(/"/g, '')}"`)
  const { data } = await db
    .from('scholarship_applications')
    .select(SCHOLARSHIP_COLUMNS)
    .or(filters.join(','))
    .order('created_at', { ascending: false })
  return withStages(db, (data ?? []) as ScholarshipApplication[])
}

/** What the history component needs — plain data, safe to pass to a client component. */
export interface ScholarshipHistoryItem {
  id: string
  eventTitle: string
  percent: number | null
  stage: ScholarshipStage
  appliedAt: string
  offeredAt: string | null
  /** The student's offer page, while there is a next step to take. */
  offerUrl: string | null
  /** Reimbursement for an already-paid student: 'cash' | 'credit' | 'manual_required'. */
  refund: { type: string; cents: number } | null
}

export function toHistoryItems(apps: ScholarshipWithStage[]): ScholarshipHistoryItem[] {
  return apps.map((a) => ({
    id: a.id,
    eventTitle: a.event_title ?? a.activity ?? 'Stellr event',
    percent: a.percent_off,
    stage: a.stage,
    appliedAt: a.created_at,
    offeredAt: a.offered_at,
    offerUrl:
      a.offer_token && (a.stage === 'awaiting_details' || a.stage === 'awaiting_payment')
        ? scholarshipOfferUrl(a.offer_token)
        : null,
    refund: a.refund && a.refund.cents > 0 ? a.refund : null,
  }))
}

/** The live offer behind a token, or null. */
export async function findOfferByToken(db: SupabaseClient, token: unknown): Promise<ScholarshipApplication | null> {
  if (!isOfferToken(token)) return null
  const { data } = await db
    .from('scholarship_applications')
    .select(SCHOLARSHIP_COLUMNS)
    .eq('offer_token', token)
    .eq('status', 'offered')
    .maybeSingle()
  return (data as ScholarshipApplication | null) ?? null
}

/** The live offer attached to a registration — what the checkout discounts. */
export async function findOfferForRegistration(
  db: SupabaseClient,
  registrationId: string,
): Promise<ScholarshipApplication | null> {
  const { data } = await db
    .from('scholarship_applications')
    .select(SCHOLARSHIP_COLUMNS)
    .eq('registration_id', registrationId)
    .eq('status', 'offered')
    .maybeSingle()
  return (data as ScholarshipApplication | null) ?? null
}

/**
 * Links an offer to the registration the student has just created (or already
 * had), and records the discounted amount due on it. Idempotent; only an
 * unlinked offer, or one already on this registration, is changed.
 */
export async function attachOfferToRegistration(
  db: SupabaseClient,
  offer: Pick<ScholarshipApplication, 'id' | 'percent_off' | 'registration_id'>,
  registration: { id: string; amount_due_cents: number | null; status: string },
  memberId: string | null,
): Promise<void> {
  if (offer.registration_id && offer.registration_id !== registration.id) return
  const patch: Record<string, unknown> = { registration_id: registration.id }
  if (memberId) patch.member_id = memberId
  const { error } = await db.from('scholarship_applications').update(patch).eq('id', offer.id)
  if (error) {
    // Most likely the one-offer-per-registration index. Don't discount a
    // registration the offer isn't attached to.
    console.error('[scholarship] could not attach offer to registration:', error.message, { offer: offer.id, registration: registration.id })
    return
  }
  if (registration.status === 'pending' && offer.percent_off != null) {
    // amount_due_cents is the undiscounted fee until an offer lands on it, so
    // only discount once: skip if this registration was already linked.
    if (offer.registration_id !== registration.id) {
      await db
        .from('registrations')
        .update({ amount_due_cents: discountedCents(registration.amount_due_cents ?? 0, offer.percent_off) })
        .eq('id', registration.id)
    }
  }
}

// ── Stripe ────────────────────────────────────────────────────────────────────

export class ScholarshipCouponError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScholarshipCouponError'
  }
}

function isMissing(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === 'resource_missing'
}

/**
 * The Stripe coupon id for a level. Accepts the code as a coupon id or as a
 * promotion code (active or not), and refuses a coupon whose percentage
 * differs from the level — a student must never be charged a different
 * amount from the one their offer email states.
 */
export async function resolveScholarshipCoupon(stripe: Stripe, percent: ScholarshipPercent): Promise<string> {
  const code = scholarshipCode(percent)
  let coupon: Stripe.Coupon | null = null
  try {
    coupon = await stripe.coupons.retrieve(code)
  } catch (e) {
    if (!isMissing(e)) throw e
  }
  if (!coupon) {
    const { data } = await stripe.promotionCodes.list({ code, limit: 1, expand: ['data.promotion.coupon'] })
    const promo = data[0]
    const c = promo?.promotion?.coupon
    if (c && typeof c === 'object') coupon = c
    else if (typeof c === 'string') coupon = await stripe.coupons.retrieve(c)
  }
  if (!coupon) throw new ScholarshipCouponError(`No Stripe coupon or promotion code named ${code}`)
  if (!coupon.valid) throw new ScholarshipCouponError(`Stripe coupon ${coupon.id} (${code}) is no longer valid`)
  // Within a point: a "33%" coupon may be set up in Stripe as 33.33%. Anything
  // further off is a different level, and the offer email would be wrong.
  if (coupon.percent_off == null || Math.abs(coupon.percent_off - percent) >= 1) {
    throw new ScholarshipCouponError(
      `Stripe coupon ${coupon.id} (${code}) is ${coupon.percent_off ?? 'not a'}% off, expected ${percent}%`,
    )
  }
  return coupon.id
}

/**
 * Whether each level's coupon resolves in this Stripe account — shown on the
 * review page so a missing or mis-set coupon is caught before an offer is
 * made, not when the student tries to pay. Null means OK.
 */
export async function checkScholarshipCoupons(stripe: Stripe): Promise<Record<number, string | null>> {
  const out: Record<number, string | null> = {}
  await Promise.all(
    SCHOLARSHIP_LEVELS.map(async (l) => {
      try {
        await resolveScholarshipCoupon(stripe, l.percent)
        out[l.percent] = null
      } catch (e) {
        out[l.percent] = e instanceof ScholarshipCouponError ? e.message : 'Stripe lookup failed'
      }
    }),
  )
  return out
}
