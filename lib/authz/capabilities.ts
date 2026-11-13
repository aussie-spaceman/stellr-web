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
 *     access console, view-as, privacy requests.
 *
 * Event Managers are not here: their access is per event (decideEventAccess).
 * Pure and DB-free, like lib/authz/decide.ts, so proxy.ts and tests can import it.
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

/** Every capability this principal holds, for the admin layout to hide what it cannot use. */
export function capabilitiesOf(p: Principal, source: DecisionSource, contextTenantId: string = STELLR_TENANT_ID): Capability[] {
  return CAPABILITIES.filter((c) => decideCapability(p, c, source, contextTenantId).ok)
}
