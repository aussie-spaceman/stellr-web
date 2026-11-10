import type { SupabaseClient } from '@supabase/supabase-js'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import {
  ELIGIBILITY_UNAVAILABLE_MESSAGE,
  eligibilityContextFromMirror,
  eligibilityContextProblem,
  type EligibilityUnavailableDetail,
  type PlatformOwnerEligibilityContext,
  type TenantEligibilityContext,
  type TenantForEligibility,
} from './eligibility'
import { eventOwner, rowTenant, TENANT_PAYMENTS_UNAVAILABLE } from './event-context'

// Whose rules apply when a participant is written to a registration that already
// exists (multi-tenancy plan S5, A8): the organiser's roster add and edit, the staff
// roster add, and the roster sheet import. The register routes resolve their event
// from the CMS first (lib/registration/event-context); these writers start from the
// registration row, so its tenant_id decides.
//
//   • Stellr's registration (tenant_id is Stellr's, or NULL on a row the backfill has
//     not reached): today's rules, with no read. The age is taken on today's date, as
//     these writers always have, so assertEligible makes exactly the old call
//     (checkRegistrationAge with no event date).
//   • Any other tenant's registration: the event's row in the events mirror, found by
//     the registration's slug, must belong to the same tenant (the derivation trigger
//     stamps participants by slug), and the tenant row is read. The context is the
//     tenant one assertEligible takes on a register route. A failed read refuses,
//     retryably; a missing or mismatched row, or rules that can't be worked out,
//     refuse with the eligibility answer. Nothing is ever taken to mean Stellr.
//
// Every row these writers insert carries the context's tenantId as tenant_id,
// Stellr's included. participants takes its tenant from its parent registration
// (tenancy_inherit_tenant_id): the registration's tenant decides, and the supplied
// value is only a cross-check that matches it. It does not, on its own, keep a write
// possible after the derivation enforce flip; that rests on the registration being
// stamped.

/** The registration columns this needs. */
export interface RosterRegistration {
  tenant_id?: string | null
  event_slug: string
}

/** The registration columns that show a group takes money (lib/group-billing billingMode, teacher-share, split). */
export const TENANT_MONEY_COLUMNS = 'invoice_requested, stripe_payment_intent_id, amount_due_cents, late_joiner_payer, share_estimate'

export interface RosterMoneyColumns {
  invoice_requested?: boolean | null
  stripe_payment_intent_id?: string | null
  amount_due_cents?: number | null
  late_joiner_payer?: string | null
  share_estimate?: number | null
}

export type RosterContext =
  | { ok: true; tenantId: typeof STELLR_TENANT_ID; isPlatformOwner: true; eligibility: PlatformOwnerEligibilityContext }
  | { ok: true; tenantId: string; isPlatformOwner: false; eligibility: TenantEligibilityContext }
  /** A read failed: retryable. Nothing about the person was looked at. */
  | { ok: false; reason: 'unavailable' }
  /** The event's rules can't be worked out for this tenant's registration. */
  | { ok: false; reason: 'rules_unavailable'; detail: EligibilityUnavailableDetail }

const STELLR_ROSTER: RosterContext = {
  ok: true,
  tenantId: STELLR_TENANT_ID,
  isPlatformOwner: true,
  eligibility: { kind: 'platform_owner', isPlatformOwner: true, tenantId: STELLR_TENANT_ID, eventDate: null },
}

/** The context for a write to this registration's roster. Never throws. */
export async function resolveRosterContext(
  db: SupabaseClient,
  registration: RosterRegistration,
  label: string,
): Promise<RosterContext> {
  const tenantId = rowTenant(registration.tenant_id)
  if (tenantId === STELLR_TENANT_ID) return STELLR_ROSTER

  const rulesUnavailable = (detail: EligibilityUnavailableDetail): RosterContext => {
    console.warn(`[${label}] a tenant registration's rules could not be worked out:`, detail)
    return { ok: false, reason: 'rules_unavailable', detail }
  }
  try {
    const owner = await eventOwner(db, registration.event_slug)
    if (!owner.ok) {
      console.error(`[${label}] event owner lookup failed`)
      return { ok: false, reason: 'unavailable' }
    }
    if (!owner.row) return rulesUnavailable('event_missing')
    if (owner.tenantId !== tenantId) return rulesUnavailable('tenant_mismatch')

    const { data, error } = await db
      .from('tenants')
      .select('id, is_platform_owner, min_participant_age')
      .eq('id', tenantId)
      .maybeSingle()
    if (error) {
      console.error(`[${label}] tenant lookup failed:`, (error as { message?: string }).message)
      return { ok: false, reason: 'unavailable' }
    }
    const eligibility = eligibilityContextFromMirror(owner.row, (data as TenantForEligibility | null) ?? null)
    // A tenant's registration never takes Stellr's rules, even if its rows say so.
    if (eligibility.kind !== 'tenant') {
      return rulesUnavailable(eligibility.kind === 'unresolved' ? eligibility.detail : 'tenant_mismatch')
    }
    const problem = eligibilityContextProblem(eligibility)
    if (problem) return rulesUnavailable(problem)
    return { ok: true, tenantId, isPlatformOwner: false, eligibility }
  } catch (e) {
    console.error(`[${label}] roster context lookup failed:`, e)
    return { ok: false, reason: 'unavailable' }
  }
}

/**
 * True when a group shows any sign of taking money: an invoice, a card payment, an
 * amount due, a split invoice or a shared teacher's cost. A tenant's group with any
 * of these is refused by the roster writers until S9, before any Stripe call.
 */
export function rosterTakesMoney(reg: RosterMoneyColumns): boolean {
  return (
    reg.invoice_requested === true ||
    !!reg.stripe_payment_intent_id ||
    (reg.amount_due_cents ?? 0) > 0 ||
    reg.late_joiner_payer != null ||
    reg.share_estimate != null
  )
}

/** The status and body for a context that refused, as the roster writers answer it. */
export function rosterRefusal(ctx: Extract<RosterContext, { ok: false }>): { status: number; body: Record<string, unknown> } {
  if (ctx.reason === 'rules_unavailable') {
    return { status: 503, body: { code: 'eligibility_unavailable', error: ELIGIBILITY_UNAVAILABLE_MESSAGE } }
  }
  return { status: 503, body: { error: 'Registration is temporarily unavailable. Please try again shortly.' } }
}

/** The tenant payments answer, as a status and body. */
export function rosterPaymentsRefusal(): { status: number; body: Record<string, unknown> } {
  return { status: 503, body: { ...TENANT_PAYMENTS_UNAVAILABLE } }
}

/**
 * A participant row as a team route answers it: every column but tenant_id, which is
 * read for the server's checks and stays on the server (PR amendments, response bodies).
 */
export function withoutTenantId<T extends Record<string, unknown>>(row: T): Omit<T, 'tenant_id'> {
  const { tenant_id: _tenantId, ...rest } = row
  return rest
}

/** True when a write error is the participants eligibility trigger's refusal (A3, SQLSTATE 23514). */
export function isEligibilityRefusal(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === '23514'
}
