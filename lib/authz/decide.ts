/**
 * The pure decision core of lib/authz.ts (multi-tenancy plan S5, slice C1).
 *
 * No I/O, no Clerk, no database: every function here takes what it needs and
 * returns an answer, so the equivalence harness (lib/authz/equivalence.test.ts)
 * can run each one over the whole truth table.
 *
 * Two sources of authority, chosen by AUTHZ_SOURCE (see authzSource()):
 *
 *   clerk     TODAY'S RULES, the default. The Clerk session claim
 *             metadata.role decides: 'admin' is a Stellr admin, 'event_manager'
 *             is a Stellr event manager confined to event_manager_assignments.
 *             admin_duties grants scopes only, never the portal.
 *   postgres  The S3 tables decide: platform_admins, and tenant_memberships
 *             (tenant_admin | event_manager | staff) per tenant. Clerk is used
 *             for identity (the user id) only.
 *
 * 'shadow' decides by clerk and compares with postgres; it is handled in
 * lib/authz.ts, so the functions here only ever see 'clerk' or 'postgres'.
 *
 * For Stellr the postgres rules are the S3 role mapping
 * (lib/tenancy/role-mapping.ts) read backwards, so a complete, synced mapping
 * gives the same answers as clerk. Two places where today's data can drift and
 * the answers differ are pinned by the harness: a Clerk event_manager with no
 * assignment, and an assignment held by someone without the Clerk role.
 *
 * The clerk source knows only Stellr. Any other tenant passed to a decision is
 * refused, so a non-Stellr host fails closed until AUTHZ_SOURCE is postgres. It
 * cannot see which tenant owns an event (legacy reads no events row), so a real
 * second tenant's events need AUTHZ_SOURCE=postgres before they exist.
 *
 * This file is the only part of lib/authz that proxy.ts may import: it has no
 * server-only, Clerk or database dependency. Import from '@/lib/authz/decide',
 * never from '@/lib/authz'.
 *
 * Never an age decision here: eligibility is the registration lane's
 * assertEligible().
 */
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import type { TenantRole } from '@/lib/tenancy/role-mapping'

export type { TenantRole }

export type Claims = Record<string, unknown> | null | undefined

/** Where a decision's authority comes from. */
export type AuthzSource = 'clerk' | 'shadow' | 'postgres'
/** The two sources a decision can actually be computed from. */
export type DecisionSource = 'clerk' | 'postgres'

export const AUTHZ_SOURCES: readonly AuthzSource[] = ['clerk', 'shadow', 'postgres']

/**
 * The configured source, ignoring case and surrounding space. Anything other
 * than 'shadow' or 'postgres' (unset, empty, a typo) is 'clerk': a bad value
 * keeps today's behaviour rather than switching authority.
 */
export function authzSource(value: string | undefined): AuthzSource {
  const v = (value ?? '').trim().toLowerCase()
  return v === 'shadow' || v === 'postgres' ? v : 'clerk'
}

/** Set, but not a source: authzSource() fell back to clerk, and someone should know. */
export function isUnrecognisedAuthzSource(value: string | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase()
  return v !== '' && !(AUTHZ_SOURCES as readonly string[]).includes(v)
}

/** S6 support mode placeholder: 'support_read' will refuse every mutation. */
export type PrincipalMode = 'normal' | 'support_read'

export interface Membership {
  tenantId: string
  role: TenantRole
}

/**
 * Who is asking. `claimsRole` is the Clerk session claim (the clerk source);
 * `memberId`, `platformAdmin` and `memberships` come from the platform tables
 * (the postgres source). A principal built for the clerk source leaves the
 * table fields empty; that is never read by a clerk decision.
 */
export interface Principal {
  userId: string | null
  claimsRole: string | undefined
  memberId: string | null
  platformAdmin: boolean
  memberships: readonly Membership[]
  mode: PrincipalMode
}

/** Why access was granted, for audit(). */
export type Via = 'clerk' | 'platform' | 'membership' | 'assignment'

export type Decision =
  | { ok: true; via: Via; tenantId: string }
  | { ok: false; status: 401 | 403 }

const DENY_401 = { ok: false, status: 401 } as const
const DENY_403 = { ok: false, status: 403 } as const

/** The signed-out principal. Every decision denies it. */
export function anonymousPrincipal(): Principal {
  return { userId: null, claimsRole: undefined, memberId: null, platformAdmin: false, memberships: [], mode: 'normal' }
}

// ── Claims (DB-free) ────────────────────────────────────────────────────────

/** The Clerk role surfaced into the session claim, or undefined. */
export function roleFromClaims(claims: Claims): string | undefined {
  const role = (claims?.metadata as { role?: unknown } | undefined)?.role
  return typeof role === 'string' ? role : undefined
}

/**
 * The portal role a session claim carries: 'admin', 'event_manager' or null.
 * Pure and DB-free, for proxy.ts (it runs on every request and must not query).
 */
export function portalRoleFromClaims(claims: Claims): 'admin' | 'event_manager' | null {
  const role = roleFromClaims(claims)
  return role === 'admin' || role === 'event_manager' ? role : null
}

/** The role on a Clerk user record: what isCrewTarget takes as `clerkRole`. Not a string check: the decision makes that. */
export function roleFromClerkUser(user: { publicMetadata?: unknown } | null | undefined): unknown {
  return (user?.publicMetadata as { role?: unknown } | null | undefined)?.role
}

// ── Primitives ──────────────────────────────────────────────────────────────

function hasMembership(p: Principal, tenantId: string, roles: readonly TenantRole[]): TenantRole | null {
  for (const m of p.memberships) if (m.tenantId === tenantId && roles.includes(m.role)) return m.role
  return null
}

/**
 * The roles a principal holds in a tenant. Under clerk only Stellr has roles,
 * read from the claim (admin -> tenant_admin, event_manager -> event_manager);
 * 'duty_holder' is not in the claim, so clerk never reports it.
 */
export function tenantRoles(p: Principal, tenantId: string, source: DecisionSource): TenantRole[] {
  if (!p.userId) return []
  if (source === 'clerk') {
    if (tenantId !== STELLR_TENANT_ID) return []
    if (p.claimsRole === 'admin') return ['tenant_admin']
    if (p.claimsRole === 'event_manager') return ['event_manager']
    return []
  }
  return [...new Set(p.memberships.filter((m) => m.tenantId === tenantId).map((m) => m.role))]
}

/**
 * Platform administrator. Under clerk there is no separate platform list:
 * today every Clerk admin administers everything, but only from Stellr
 * (`contextTenantId`); on any other tenant's host clerk refuses. Under postgres,
 * the platform_admins table only.
 */
export function decidePlatformAdmin(p: Principal, source: DecisionSource, contextTenantId: string = STELLR_TENANT_ID): Decision {
  if (!p.userId) return DENY_401
  if (source === 'clerk') {
    return p.claimsRole === 'admin' && contextTenantId === STELLR_TENANT_ID ? { ok: true, via: 'clerk', tenantId: STELLR_TENANT_ID } : DENY_403
  }
  return p.platformAdmin ? { ok: true, via: 'platform', tenantId: STELLR_TENANT_ID } : DENY_403
}

/**
 * Does the platform bypass reach this tenant? Stellr always. Another tenant only
 * in S6 support mode (plan decision 18): reason, consent, TTL and step-up are
 * S6's to enforce, and every principal is 'normal' until then, so a platform
 * admin gets into another tenant's data only through a membership there.
 */
function platformReaches(p: Principal, tenantId: string): boolean {
  return p.platformAdmin && (tenantId === STELLR_TENANT_ID || p.mode !== 'normal')
}

/** Holds one of `roles` in `tenantId`. A platform admin is NOT implied here. */
export function decideTenantRole(p: Principal, tenantId: string, roles: readonly TenantRole[], source: DecisionSource): Decision {
  if (!p.userId) return DENY_401
  if (roles.length === 0) return DENY_403
  if (source === 'clerk') {
    return tenantRoles(p, tenantId, 'clerk').some((r) => roles.includes(r)) ? { ok: true, via: 'clerk', tenantId } : DENY_403
  }
  return hasMembership(p, tenantId, roles) ? { ok: true, via: 'membership', tenantId } : DENY_403
}

// ── Composites ──────────────────────────────────────────────────────────────

/**
 * A Stellr admin: the clerk 'admin' claim, or (postgres) a platform admin or a
 * tenant_admin of Stellr. Replaces isAdminClaims / currentUserIsAdmin and the
 * admin-only wrappers. Only from Stellr (`contextTenantId`): on another tenant's
 * host nobody is a Stellr admin, in either source.
 */
export function decideStellrAdmin(p: Principal, source: DecisionSource, contextTenantId: string = STELLR_TENANT_ID): Decision {
  if (!p.userId) return DENY_401
  if (contextTenantId !== STELLR_TENANT_ID) return DENY_403
  if (source === 'clerk') return decidePlatformAdmin(p, 'clerk')
  if (p.platformAdmin) return { ok: true, via: 'platform', tenantId: STELLR_TENANT_ID }
  return decideTenantRole(p, STELLR_TENANT_ID, ['tenant_admin'], 'postgres')
}

/**
 * Staff of a tenant holding one of `roles`. A platform admin passes Stellr, and
 * another tenant in support mode only (postgres); under clerk a Stellr admin
 * passes Stellr.
 */
export function decideTenantCrew(p: Principal, tenantId: string, roles: readonly TenantRole[], source: DecisionSource): Decision {
  if (!p.userId) return DENY_401
  if (source === 'postgres' && platformReaches(p, tenantId)) return { ok: true, via: 'platform', tenantId }
  return decideTenantRole(p, tenantId, roles, source)
}

/**
 * May enter the admin portal shell: an admin or an event manager. 'duty_holder'
 * NEVER grants the portal: today an admin_duties holder without the Clerk admin
 * claim cannot enter /admin, and Stellr stays that way.
 */
export function decidePortalAccess(p: Principal, source: DecisionSource, tenantId: string = STELLR_TENANT_ID): Decision {
  if (!p.userId) return DENY_401
  if (source === 'clerk') {
    return tenantId === STELLR_TENANT_ID && p.claimsRole !== undefined && PORTAL_CLERK_ROLES.includes(p.claimsRole)
      ? { ok: true, via: 'clerk', tenantId: STELLR_TENANT_ID }
      : DENY_403
  }
  return decideTenantCrew(p, tenantId, ['tenant_admin', 'event_manager'], 'postgres')
}

/** An event manager in `tenantId` (not an admin). */
export function isEventManager(p: Principal, tenantId: string, source: DecisionSource): boolean {
  return tenantRoles(p, tenantId, source).includes('event_manager')
}

/** One event_manager_assignments row as read for a decision. */
export interface Assignment {
  eventSlug: string
  /** The row's derived tenant_id; null while the S3 derivation is log-only. */
  tenantId: string | null
}

/**
 * The slugs of `assignments` that belong to `tenantId`. A row whose tenant_id
 * is still null (derivation in log mode) counts as Stellr's, because every
 * event is Stellr's until a second tenant exists. An event_manager is confined
 * to assignments inside the event's tenant.
 */
export function assignedSlugsInTenant(assignments: readonly Assignment[], tenantId: string): string[] {
  return assignments
    .filter((a) => (a.tenantId ?? STELLR_TENANT_ID) === tenantId)
    .map((a) => a.eventSlug)
}

/**
 * The legacy lib/event-access.ts return shape, plus the tenant it holds in.
 * isAdmin and assignedSlugs: null mean every event OF `tenantId`, not every
 * event. A caller that loads a row by global id must check the row with
 * eventAccessCovers (or lib/authz accessCoversEvent), not trust the flag.
 */
export type EventAccess =
  | { ok: true; userId: string; isAdmin: boolean; assignedSlugs: string[] | null; tenantId: string } // null = all events in tenantId
  | { ok: false; status: 401 | 403 }

export interface EventAccessInput {
  /** The event asked about, or undefined for section-level access. */
  eventSlug?: string
  /** The tenant that owns the event (or the current tenant, for section access). */
  tenantId: string
  /** The principal's assignments; only those in `tenantId` count. */
  assignments: readonly Assignment[]
}

/**
 * Per-event access. An admin of the event's tenant (or a platform admin the
 * bypass reaches) sees every event; an event manager sees only their
 * assignments in that tenant; anyone else is refused.
 */
export function decideEventAccess(p: Principal, input: EventAccessInput, source: DecisionSource): EventAccess {
  if (!p.userId) return DENY_401
  const admin =
    source === 'clerk'
      ? input.tenantId === STELLR_TENANT_ID && p.claimsRole === 'admin'
      : platformReaches(p, input.tenantId) || hasMembership(p, input.tenantId, ['tenant_admin']) !== null
  if (admin) return { ok: true, userId: p.userId, isAdmin: true, assignedSlugs: null, tenantId: input.tenantId }
  if (!isEventManager(p, input.tenantId, source)) return DENY_403
  const assignedSlugs = assignedSlugsInTenant(input.assignments, input.tenantId)
  if (input.eventSlug && !assignedSlugs.includes(input.eventSlug)) return DENY_403
  return { ok: true, userId: p.userId, isAdmin: false, assignedSlugs, tenantId: input.tenantId }
}

/** Does this access cover a row of `event`? The row's tenant must be the access's tenant. */
export function eventAccessCovers(access: EventAccess, event: { eventSlug: string; tenantId: string }): boolean {
  if (!access.ok || access.tenantId !== event.tenantId) return false
  return access.assignedSlugs === null || access.assignedSlugs.includes(event.eventSlug)
}

/**
 * Holds a staff scope. A Stellr admin holds every scope; otherwise the
 * member's admin_duties.scopes must include the scope or 'all'. admin_duties is
 * Stellr-only: tenants get no scopes in release 1, and the S3 mapping does not
 * carry scopes, so both sources read them from admin_duties. On any other
 * tenant's host (`contextTenantId`) no scope holds, in either source.
 */
export function decideScope(
  p: Principal,
  scopes: readonly string[] | null,
  scope: string,
  source: DecisionSource,
  contextTenantId: string = STELLR_TENANT_ID,
): boolean {
  if (!p.userId || contextTenantId !== STELLR_TENANT_ID) return false
  if (decideStellrAdmin(p, source).ok) return true
  if (!p.memberId) return false
  const held = scopes ?? []
  return held.includes('all') || held.includes(scope)
}

/** Every Clerk role that opens the admin portal (legacy CREW_CLERK_ROLES). */
export const PORTAL_CLERK_ROLES: readonly string[] = ['admin', 'event_manager']

export interface CrewTarget {
  /** The target Clerk user's publicMetadata.role (the clerk source). */
  clerkRole: unknown
  /** The target's platform flag and memberships (the postgres source). */
  platformAdmin?: boolean
  memberships?: readonly Membership[]
}

/**
 * Is the TARGET of an action (view-as, deletion) staff? Protects staff from
 * being impersonated or deleted. Clerk: the target's role opens the portal.
 * Postgres: that, or a platform admin, or a tenant_admin / event_manager
 * anywhere. This check protects, so postgres takes the union: drift between
 * Clerk and the tables can only add protection, never remove it. 'duty_holder' alone
 * does not count, as today.
 */
export function decideCrewTarget(target: CrewTarget, source: DecisionSource): boolean {
  if (typeof target.clerkRole === 'string' && PORTAL_CLERK_ROLES.includes(target.clerkRole)) return true
  if (source === 'clerk') return false
  if (target.platformAdmin) return true
  return (target.memberships ?? []).some((m) => m.role === 'tenant_admin' || m.role === 'event_manager')
}
