// Who may take part in an event: the one eligibility check for every route
// that writes a participant (multi-tenancy plan S5, registration lane, A2).
//
// The register routes call it through lib/registration/event-context (S5 A7).
// For Stellr's events it makes exactly today's call, so their answers are
// unchanged.
//
// Two kinds of context:
//
//   • The platform owner (Stellr). assertEligible calls checkRegistrationAge
//     with exactly the arguments today's routes pass: the Sanity event's
//     `date` (already the local calendar date), the person's name when the
//     route gives one, no floor, and "today" from appToday() (Denver). So a
//     route moved onto assertEligible(stellrContext(event)) behaves as it does
//     now, including COPPA's under-13s, who Stellr admits with a parent.
//
//   • Any other tenant. The floor is the highest of the platform minimum
//     (TENANT_MIN_PARTICIPANT_AGE, 14), the tenant's minimum and the event's
//     minimum, so neither a tenant row nor an event row can lower it. Age is
//     taken on the event's start date in the event's IANA time zone, and
//     "today" (for an undated campaign, and for the future-date check) is the
//     date in that zone too. It fails closed: a missing or unreadable date of
//     birth, a missing or mismatched tenant row, an unknown time zone, an
//     unusable minimum, or a dated live event with no start date all refuse.
//     Nobody under 13 today is admitted either, however far off the event is:
//     we would be collecting a child's data now, and turning 14 by the start
//     date doesn't change that.
//
// Choosing a context: only a positive read makes an event Stellr's. A Sanity
// miss, a mirror miss or a mirror read error must never become stellrContext,
// because a miss is exactly what a tenant event looks like in Sanity, and the
// result would be no age floor. Pass what you have to
// eligibilityContextFromMirror, which refuses when it's empty.
//
// The participants trigger (A3) enforces the same tenant rule in Postgres as
// a backstop; this is the check that gives the registrant a message first.

import { checkRegistrationAge, type RegistrationAgeOk, type RegistrationAgeRefused, type RegistrationAgeResult } from '@/lib/registration-eligibility'
import { onDate } from '@/lib/age'
import { isValidTimeZone, localDate } from '@/lib/survey/timezone'
import { LOADSCOPED_MODE_ENV, loadScopedMode } from '@/lib/tenancy/load-scoped-mode'
import { STELLR_TENANT_ID, TENANT_MIN_PARTICIPANT_AGE } from '@/lib/tenancy/constants'

/** Stellr's own events: today's rules, unchanged. */
export interface PlatformOwnerEligibilityContext {
  kind: 'platform_owner'
  isPlatformOwner: true
  tenantId: string
  /** The event's start date (YYYY-MM-DD, local to the event), or null for a campaign. */
  eventDate: string | null
}

/** An event run by a tenant other than the platform owner. */
export interface TenantEligibilityContext {
  kind: 'tenant'
  isPlatformOwner: false
  tenantId: string
  /** tenants.min_participant_age. Null means the tenant row was not found: refuses. */
  tenantMinAge: number | null
  /** events.min_participant_age. Null means the event sets none of its own. */
  eventMinAge: number | null
  /** events.starts_at: local midnight of the first day, as a UTC timestamp. Null when undated. */
  eventStartsAt: string | null
  /** events.time_zone (IANA). */
  eventTimeZone: string | null
  /** events.activity_type: 'live_event' | 'campaign'. Anything else counts as a live event. */
  activityType: string | null
}

/** The event and tenant could not be resolved into a context: refuses. */
export interface UnresolvedEligibilityContext {
  kind: 'unresolved'
  isPlatformOwner: false
  tenantId: string | null
  detail: EligibilityUnavailableDetail
}

export type EligibilityContext =
  | PlatformOwnerEligibilityContext
  | TenantEligibilityContext
  | UnresolvedEligibilityContext

/** Why a context cannot decide. For logs: carries no date of birth or name. */
export type EligibilityUnavailableDetail =
  | 'event_missing'
  | 'tenant_missing'
  | 'tenant_mismatch'
  | 'min_age_invalid'
  | 'time_zone_invalid'
  | 'start_date_missing'
  | 'start_date_invalid'

export interface EligibilityUnavailable {
  ok: false
  /** The event's rules could not be worked out, so nobody is admitted. */
  reason: 'eligibility_unavailable'
  detail: EligibilityUnavailableDetail
  /** Safe to show the person filling in the form. */
  error: string
}

export type EligibilityResult = RegistrationAgeResult | EligibilityUnavailable

export interface AssertEligibleOptions {
  /** Whose date of birth, for the message ("for Sam Lee"). Omit when it is the registrant's own. */
  name?: string
}

export interface AssertRegistrableOptions extends AssertEligibleOptions {
  /**
   * The route can collect a parent's or guardian's name and email and run the
   * tenant guardian-consent flow (S5 wave 6). Only register/individual does.
   * Has no effect unless tenantGuardianConsentReady(): the flag exactly "true" and its preconditions met.
   */
  guardianConsent?: boolean
}

/** assertEligible's admission, marked when it holds only once a guardian signs. */
export type RegistrableResult = EligibilityResult | (RegistrationAgeOk & { guardianConsentRequired: true })

/**
 * The tenant guardian-consent flow (S5 wave 6, owner decision 10 Nov 2026). Off
 * unless exactly "true": with it off, under-18s are refused at tenant events as
 * before. Read at call time, so a flip needs a redeploy only.
 */
export const TENANT_GUARDIAN_CONSENT_FLAG = 'TENANT_GUARDIAN_CONSENT_ENABLED'

/**
 * Whether the flag itself is exactly "true". This is the sweep's gate (the
 * membership-expiry cron): with the flag on, pending, declined and expired rows go
 * on being settled even while a precondition below is missing, since settling only
 * expires, removes and voids. Nothing that admits a minor reads it: admission reads
 * tenantGuardianConsentReady(), which also needs every precondition.
 */
export function tenantGuardianConsentEnabled(): boolean {
  return process.env[TENANT_GUARDIAN_CONSENT_FLAG] === 'true'
}

// TENANT_EVENT_MAIL_FLAG and tenantEventMailEnabled() in lib/event-emails/tenant-mail.ts,
// read here as that module reads it. Not imported: many register-route tests mock
// that module whole, and this file is on their import path.
// lib/registration/eligibility.test.ts holds the two equal.
export const CONSENT_TENANT_MAIL_FLAG = 'TENANT_EVENT_MAIL_ENABLED'

/**
 * What the flag needs in the same environment before it admits anyone (the
 * readiness guard, tracker s5-programme.20, docs/ENV-MATRIX.md): each variable and
 * the value it must resolve to. Lane C's tenant-event refusals (#624) are code, live
 * wherever this code runs, so they need no switch. Signing and the published consent
 * document are not switches: tenantGuardianConsentReadiness
 * (lib/registration/tenant-guardian-consent.ts) checks them per registration.
 */
export const TENANT_GUARDIAN_CONSENT_PRECONDITIONS = [
  // Owner decision W7-14, 13 Nov 2026: tenant-scoped loads are enforced.
  { name: LOADSCOPED_MODE_ENV, needs: 'enforce', holds: () => loadScopedMode() === 'enforce' },
  // The guardian's invitation and the registrant's notices go from the tenant's sender.
  { name: CONSENT_TENANT_MAIL_FLAG, needs: 'true', holds: () => process.env[CONSENT_TENANT_MAIL_FLAG] === 'true' },
] as const

/** The preconditions not met now, as NAME=needed. Never a set value. */
export function tenantGuardianConsentMissingPreconditions(): string[] {
  return TENANT_GUARDIAN_CONSENT_PRECONDITIONS.filter((p) => !p.holds()).map((p) => `${p.name}=${p.needs}`)
}

// The last missing set logged, so a misconfigured instance says so once per change
// rather than on every registration.
let loggedMissing: string | null = null

/** Test seam: forget what was logged, so the next refusal logs again. */
export function resetGuardianConsentReadinessLog(): void {
  loggedMissing = null
}

/**
 * The readiness guard (tracker s5-programme.20): whether a tenant-event minor may be
 * admitted consent-pending at all. True only when the flag is exactly "true" and
 * every precondition holds. With the flag on and a precondition missing it answers
 * false, so every tenant-event minor is refused as with the flag off, and logs the
 * missing preconditions by name (once per change of the missing set). With the flag
 * unset, as on production, it answers false and logs nothing.
 */
export function tenantGuardianConsentReady(): boolean {
  if (!tenantGuardianConsentEnabled()) return false
  const missing = tenantGuardianConsentMissingPreconditions()
  if (missing.length === 0) {
    loggedMissing = null
    return true
  }
  const key = missing.join(', ')
  if (loggedMissing !== key) {
    loggedMissing = key
    console.error(`[tenant-guardian-consent] ${TENANT_GUARDIAN_CONSENT_FLAG} is on but minors are refused; missing preconditions: ${key}`)
  }
  return false
}

/** Safe to show the person filling in the form. Wording is a proposal for the owner (S5 A7). */
export const ELIGIBILITY_UNAVAILABLE_MESSAGE =
  "We can't confirm who can take part in this event right now, so we can't complete this registration. Please contact the event organiser."
const UNAVAILABLE_MESSAGE = ELIGIBILITY_UNAVAILABLE_MESSAGE

/**
 * The youngest anyone can be today to register for a tenant event, whatever
 * their age on the day. The COPPA line: tenant events have no parental-consent
 * flow for under-13s. Not applied to the platform owner, which admits them with
 * a parent. The A3 trigger holds the same rule, and
 * test/registration/participants-eligibility-sql.test.ts keeps the two equal.
 */
export const TENANT_MIN_AGE_TODAY = 13

/**
 * The youngest anyone can be, today or on the day, to register for a tenant event
 * while tenants have no way to collect a guardian's consent (S5 A7). The API's
 * rule only: the A3 trigger keeps the platform floor, so a later consent flow
 * lowers this without a migration.
 */
export const TENANT_MIN_AGE_WITHOUT_GUARDIAN_CONSENT = 18

function unavailable(detail: EligibilityUnavailableDetail): EligibilityUnavailable {
  return { ok: false, reason: 'eligibility_unavailable', detail, error: UNAVAILABLE_MESSAGE }
}

/** A whole-number age, 0 or more. */
function isAge(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0
}

/** The YYYY-MM-DD an instant falls on in `tz`, or null when the timestamp is unreadable. */
function localDateOf(startsAt: string, tz: string): string | null {
  const at = new Date(startsAt)
  if (Number.isNaN(at.getTime())) return null
  return localDate(at, tz)
}

/**
 * Check a date of birth against an event's eligibility rules. Returns the same
 * result checkRegistrationAge does (so routes keep their `code` and `error`),
 * plus `eligibility_unavailable` when a tenant event's rules cannot be worked
 * out.
 */
export function assertEligible(
  dateOfBirth: unknown,
  ctx: EligibilityContext,
  opts: AssertEligibleOptions = {},
): EligibilityResult {
  if (ctx.kind === 'platform_owner') {
    // Exactly today's call: no floor, and "today" from appToday().
    return checkRegistrationAge(
      dateOfBirth,
      opts.name === undefined ? { eventDate: ctx.eventDate } : { eventDate: ctx.eventDate, name: opts.name },
    )
  }
  const problem = eligibilityContextProblem(ctx)
  if (problem) return unavailable(problem)
  if (ctx.kind === 'unresolved') return unavailable(ctx.detail)

  const tz = ctx.eventTimeZone as string
  const eventDate = ctx.eventStartsAt ? (localDateOf(ctx.eventStartsAt, tz) as string) : null
  const minAge = Math.max(TENANT_MIN_PARTICIPANT_AGE, ctx.tenantMinAge as number, ctx.eventMinAge ?? 0)
  const today = onDate(localDate(new Date(), tz))
  const result = checkRegistrationAge(dateOfBirth, {
    eventDate,
    minAge,
    today,
    ...(opts.name === undefined ? {} : { name: opts.name }),
  })
  if (result.ok && result.ageToday < TENANT_MIN_AGE_TODAY) {
    const whose = opts.name?.trim()
    return {
      ok: false,
      reason: 'under_minimum_age',
      error: whose
        ? `${whose} must be ${TENANT_MIN_AGE_TODAY} or older to register for this event.`
        : `You must be ${TENANT_MIN_AGE_TODAY} or older to register for this event.`,
    }
  }
  return result
}

/**
 * assertEligible, then the register routes' consent rule (S5 A7): on a tenant's
 * event nobody under 18, today or on the day, is admitted until tenants have a way
 * to collect a parent's or guardian's consent. Stellr's consent is its own agreement,
 * sent as Stellr, which a tenant's event does not send, and nothing records a consent
 * still owed. So this fails closed until the owner decides (docs/TENANCY-S5.md, Owner
 * gates). Stellr's events are unchanged: this returns assertEligible's answer.
 *
 * assertEligible itself stays the age floor the A3 trigger mirrors. The refusal keeps
 * the `under_minimum_age` reason so every route answers it as it does an age refusal.
 * Wording approved by the owner on 10 Nov 2026.
 *
 * S5 wave 6: with tenantGuardianConsentReady() and `guardianConsent` passed, a
 * minor who passes assertEligible is admitted with `guardianConsentRequired`, and the
 * route must save them consent-pending (lib/registration/tenant-guardian-consent.ts).
 * Group and group-join pass no `guardianConsent`, so they still refuse every minor.
 */
export function assertRegistrable(
  dateOfBirth: unknown,
  ctx: EligibilityContext,
  opts: AssertRegistrableOptions = {},
): RegistrableResult {
  const result = assertEligible(dateOfBirth, ctx, opts)
  if (!result.ok || ctx.kind === 'platform_owner' || !result.isMinor) return result
  // S5 wave 6 (owner decision, 10 Nov 2026): a minor who passed assertEligible is
  // 14 or older on the day and 13 or older today. Where the route can take a
  // guardian and the flag is on, they may register pending a guardian's consent.
  if (opts.guardianConsent && tenantGuardianConsentReady()) return { ...result, guardianConsentRequired: true }
  return minorRefusal(opts)
}

/**
 * The refusal for a minor on a tenant's event (owner-approved wording, 10 Nov 2026).
 * Exported so a route that offered guardian consent can still refuse in these words
 * when the consent flow cannot run for this event.
 */
export function minorRefusal(opts: AssertEligibleOptions = {}): RegistrationAgeRefused {
  const whose = opts.name?.trim()
  const age = TENANT_MIN_AGE_WITHOUT_GUARDIAN_CONSENT
  return {
    ok: false,
    reason: 'under_minimum_age',
    error: whose
      ? `${whose} must be ${age} or older to register for this event online. Please contact the event organiser.`
      : `You must be ${age} or older to register for this event online. Please contact the event organiser.`,
  }
}

/**
 * Why this context cannot decide anyone's eligibility, or null when it can. The
 * same checks assertEligible makes before it looks at a date of birth, so a route
 * can refuse a tenant event whose rules are unusable before it reads the people
 * (S5 A7). Null for the platform owner, whose rules need nothing from the event
 * beyond its date.
 *
 * A live tenant event with no start date answers 'start_date_missing': the day
 * ages are taken on is unknown, so it refuses. That stays so until the owner
 * decides how such events are dated (docs/TENANCY-S5.md, Owner gates).
 */
export function eligibilityContextProblem(ctx: EligibilityContext): EligibilityUnavailableDetail | null {
  if (ctx.kind === 'platform_owner') return null
  if (ctx.kind === 'unresolved') return ctx.detail
  if (ctx.tenantMinAge === null) return 'tenant_missing'
  if (!isAge(ctx.tenantMinAge)) return 'min_age_invalid'
  if (ctx.eventMinAge !== null && !isAge(ctx.eventMinAge)) return 'min_age_invalid'
  const tz = ctx.eventTimeZone
  if (!tz || !isValidTimeZone(tz)) return 'time_zone_invalid'
  if (ctx.eventStartsAt) {
    if (!localDateOf(ctx.eventStartsAt, tz)) return 'start_date_invalid'
  } else if (ctx.activityType !== 'campaign') {
    return 'start_date_missing'
  }
  return null
}

/**
 * The context for a Stellr event read from Sanity, as today's register routes
 * read it. Sanity's `date` is the event's local calendar date.
 *
 * The event must have been found: a Sanity event with no date is an undated
 * campaign, but no event at all is not known to be Stellr's, so it refuses. For
 * a Stellr writer that has no event, use stellrUndatedContext.
 */
export function stellrContext(event: { date?: string | null }): PlatformOwnerEligibilityContext | UnresolvedEligibilityContext {
  if (event === null || event === undefined) {
    return { kind: 'unresolved', isPlatformOwner: false, tenantId: null, detail: 'event_missing' }
  }
  return {
    kind: 'platform_owner',
    isPlatformOwner: true,
    tenantId: STELLR_TENANT_ID,
    eventDate: event.date ?? null,
  }
}

/** Both marks of the platform owner: Stellr's id and the flag, strictly true. */
function isStellrRow(tenant: TenantForEligibility): boolean {
  return tenant.id === STELLR_TENANT_ID && tenant.is_platform_owner === true
}

/**
 * For a writer with no event to date from (the sheet sync, onboarding): today's
 * date-only check, once a tenant row read for this write has shown it is Stellr.
 * A row that can't be read, or isn't Stellr's, refuses.
 */
export function stellrUndatedContext(
  tenant: TenantForEligibility | null | undefined,
): PlatformOwnerEligibilityContext | UnresolvedEligibilityContext {
  if (!tenant) return { kind: 'unresolved', isPlatformOwner: false, tenantId: null, detail: 'tenant_missing' }
  if (!isStellrRow(tenant)) return { kind: 'unresolved', isPlatformOwner: false, tenantId: tenant.id, detail: 'tenant_mismatch' }
  return { kind: 'platform_owner', isPlatformOwner: true, tenantId: tenant.id, eventDate: null }
}

/** The events-mirror columns the context needs (lib/events/mirror.ts MirroredEvent). */
export interface MirrorEventForEligibility {
  tenant_id: string
  activity_type: string | null
  starts_at: string | null
  time_zone: string | null
  min_participant_age: number | null
}

/** The tenants columns the context needs. */
export interface TenantForEligibility {
  id: string
  is_platform_owner: boolean
  min_participant_age: number | null
}

/**
 * The context for an event read from the Postgres mirror, with its tenant row
 * (null when either could not be read, which refuses). A platform-owner event
 * becomes the Stellr context, its date taken from starts_at in the event's zone
 * (which equals Sanity's `date` by construction, lib/events/sync.ts). That takes
 * both Stellr's id and the owner flag: if only one is there, the row is wrong,
 * and it refuses rather than guess which floor applies.
 */
export function eligibilityContextFromMirror(
  event: MirrorEventForEligibility | null | undefined,
  tenant: TenantForEligibility | null | undefined,
): EligibilityContext {
  if (!event) return { kind: 'unresolved', isPlatformOwner: false, tenantId: tenant?.id ?? null, detail: 'event_missing' }
  if (!tenant) return { kind: 'unresolved', isPlatformOwner: false, tenantId: event.tenant_id ?? null, detail: 'tenant_missing' }
  if (tenant.id !== event.tenant_id) {
    return { kind: 'unresolved', isPlatformOwner: false, tenantId: event.tenant_id ?? null, detail: 'tenant_mismatch' }
  }
  if (tenant.is_platform_owner === true || tenant.id === STELLR_TENANT_ID) {
    if (!isStellrRow(tenant)) {
      return { kind: 'unresolved', isPlatformOwner: false, tenantId: tenant.id, detail: 'tenant_mismatch' }
    }
    let eventDate: string | null = null
    if (event.starts_at) {
      if (!event.time_zone || !isValidTimeZone(event.time_zone)) {
        return { kind: 'unresolved', isPlatformOwner: false, tenantId: tenant.id, detail: 'time_zone_invalid' }
      }
      eventDate = localDateOf(event.starts_at, event.time_zone)
      if (!eventDate) return { kind: 'unresolved', isPlatformOwner: false, tenantId: tenant.id, detail: 'start_date_invalid' }
    }
    return { kind: 'platform_owner', isPlatformOwner: true, tenantId: tenant.id, eventDate }
  }
  return {
    kind: 'tenant',
    isPlatformOwner: false,
    tenantId: tenant.id,
    tenantMinAge: tenant.min_participant_age ?? null,
    eventMinAge: event.min_participant_age ?? null,
    eventStartsAt: event.starts_at,
    eventTimeZone: event.time_zone,
    activityType: event.activity_type,
  }
}
