/**
 * Capabilities: what a portal role may do, named once (Staff role, 13 Nov 2026).
 *
 * Staff sits between Event Manager (a volunteer, one event) and Admin (the whole
 * tenancy). It is a named SET of capabilities, not "admin minus X": a capability
 * added for a new admin feature is admin-only until someone adds it to Staff on
 * purpose. Deny by default.
 *
 * Owner decisions (13 Nov 2026):
 *   - Staff reads the whole admin portal, except the pages in
 *     STAFF_HIDDEN_ADMIN_PATHS (view-as, Duties, the access console, privacy
 *     requests).
 *   - Staff writes Competitions (events, rosters, check-in, event emails,
 *     surveys, assigning Event Managers, refunds and payment changes) and
 *     Members (member records, schools, volunteers).
 *   - Staff exports as an admin does; every export is logged.
 *   - Admin only, to keep duties apart: clearing people (background-check
 *     adjudication, verifying external checks and teaching licences), deleting
 *     or merging members, granting Staff or Admin, Duties, scholarships, the
 *     store catalogue, the access console, view-as, privacy requests.
 *
 * Event Managers are not here: their access is per event (decideEventAccess).
 * DB-free and Clerk-free, like lib/authz/decide.ts, so proxy.ts and tests can
 * import it. The one stateful piece, createStaffSecondFactorCheck, is handed its
 * Clerk read by lib/authz.ts.
 */
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { decideStellrAdmin, isStellrStaff, type DecisionSource, type Principal } from './decide'

export const CAPABILITIES = [
  // Read
  'portal:read',
  // Competitions
  'competitions:write',
  'refunds:write',
  'event_managers:assign',
  // Members
  'members:write',
  'schools:write',
  'volunteers:write',
  // Data out
  'export',
  // Admin only
  'scholarships:write',
  'store:write',
  'access:manage',
  'roles:manage',
  'duties:manage',
  'clearance:verify',
  'members:delete',
  'impersonate',
  'privacy:read',
] as const

export type Capability = (typeof CAPABILITIES)[number]

/** Staff's set. Anything not listed is admin-only. */
export const STAFF_CAPABILITIES: readonly Capability[] = [
  'portal:read',
  'competitions:write',
  'refunds:write',
  'event_managers:assign',
  'members:write',
  'schools:write',
  'volunteers:write',
  'export',
]

export type CapabilityDecision = { ok: true; via: 'admin' | 'staff' } | { ok: false; status: 401 | 403 }

/**
 * May this principal use `cap` in `contextTenantId`? A Stellr admin may use every
 * capability; Stellr Staff only STAFF_CAPABILITIES; anyone else none. Staff is
 * Stellr's alone, so on another tenant's host only an admin decision can pass.
 */
export function decideCapability(
  p: Principal,
  cap: Capability,
  source: DecisionSource,
  contextTenantId: string = STELLR_TENANT_ID,
): CapabilityDecision {
  if (!p.userId) return { ok: false, status: 401 }
  if (decideStellrAdmin(p, source, contextTenantId).ok) return { ok: true, via: 'admin' }
  if (isStellrStaff(p, source, contextTenantId) && STAFF_CAPABILITIES.includes(cap)) return { ok: true, via: 'staff' }
  return { ok: false, status: 403 }
}

/**
 * Every capability this principal holds, for the admin layout to hide what it
 * cannot use. `staffSecondFactor: false` drops what Staff alone would give
 * (gateStaffOnSecondFactor); lib/authz.ts passes the session's answer.
 */
export function capabilitiesOf(
  p: Principal,
  source: DecisionSource,
  contextTenantId: string = STELLR_TENANT_ID,
  opts: { staffSecondFactor?: boolean } = {},
): Capability[] {
  const secondFactor = opts.staffSecondFactor ?? true
  return CAPABILITIES.filter((c) => gateStaffOnSecondFactor(decideCapability(p, c, source, contextTenantId), secondFactor).ok)
}

// ── Staff needs a second factor on the session (staff-role.8) ───────────────
//
// MFA is a Staff prerequisite (lib/staff.ts). The grant pauses when it lapses,
// but only once something reconciles it. So every request that would be allowed
// BECAUSE the caller is Staff also checks this session: with no second factor
// the caller holds no Staff capability. An admin decision is never gated here.
// The check can also ask for a reconcile (onMissing); lib/authz.ts does not wire
// that yet (see the note there).

/** What the session says about a second factor. 'unknown' when the token does not carry it. */
export type SessionSecondFactor = 'verified' | 'absent' | 'unknown'

/**
 * Pure: Clerk's auth().factorVerificationAge is [minutes since the first factor,
 * minutes since the second], with -1 for a factor never verified in this session,
 * and null when the session token does not carry it.
 */
export function secondFactorFromSession(factorVerificationAge: unknown): SessionSecondFactor {
  if (!Array.isArray(factorVerificationAge)) return 'unknown'
  const second: unknown = factorVerificationAge[1]
  return typeof second === 'number' && Number.isFinite(second) && second >= 0 ? 'verified' : 'absent'
}

/** Pure: a decision that passed only because the caller is Staff stands only with a second factor. */
export function gateStaffOnSecondFactor(d: CapabilityDecision, hasSecondFactor: boolean): CapabilityDecision {
  return d.ok && d.via === 'staff' && !hasSecondFactor ? { ok: false, status: 403 } : d
}

/** How long an account's two-step setting read from Clerk is reused. */
export const STAFF_MFA_CACHE_MS = 60_000
/** Cap on the in-memory maps; Staff is a handful of people, so this only bounds a leak. */
const STAFF_MFA_CACHE_MAX = 500

export interface StaffSecondFactorDeps {
  /** twoFactorEnabled on the Clerk user. Throws when it cannot be read. */
  readTwoFactorEnabled(userId: string): Promise<boolean>
  /** Fire and forget: reconcile this user's Staff grant. Must not throw or be awaited. Optional: see lib/authz.ts. */
  onMissing?(userId: string): void
  now?: () => number
}

/**
 * The per-request check, with its state. From the session when the token says;
 * otherwise from the account's two-step setting, reused for at most
 * STAFF_MFA_CACHE_MS. A failed read is no second factor (fail closed) and is not
 * cached. A definite "no" asks for a reconcile, at most once per user per
 * STAFF_MFA_CACHE_MS; a failed read does not, so a Clerk outage pauses no one.
 */
export function createStaffSecondFactorCheck(deps: StaffSecondFactorDeps): (userId: string, factorVerificationAge: unknown) => Promise<boolean> {
  const accountSetting = new Map<string, { value: boolean; at: number }>()
  const reconciled = new Map<string, number>()
  const now = () => deps.now?.() ?? Date.now()
  const remember = <V>(m: Map<string, V>, k: string, v: V) => {
    if (m.size >= STAFF_MFA_CACHE_MAX) m.clear()
    m.set(k, v)
  }

  async function fromAccount(userId: string): Promise<boolean | null> {
    const hit = accountSetting.get(userId)
    if (hit && now() - hit.at < STAFF_MFA_CACHE_MS) return hit.value
    try {
      const value = (await deps.readTwoFactorEnabled(userId)) === true
      remember(accountSetting, userId, { value, at: now() })
      return value
    } catch {
      return null
    }
  }

  return async function hasStaffSecondFactor(userId, factorVerificationAge) {
    const session = secondFactorFromSession(factorVerificationAge)
    const ok = session === 'unknown' ? await fromAccount(userId) : session === 'verified'
    if (ok === false) {
      const last = reconciled.get(userId)
      if (last === undefined || now() - last >= STAFF_MFA_CACHE_MS) {
        remember(reconciled, userId, now())
        try {
          deps.onMissing?.(userId)
        } catch {
          // Best effort: the daily sweep is the backstop.
        }
      }
    }
    return ok === true
  }
}
