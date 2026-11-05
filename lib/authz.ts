/**
 * lib/authz.ts — one authorisation API (multi-tenancy plan S5, slice C1).
 *
 * INERT IN C1: nothing imports this module yet. Later S5 slices move the
 * twelve legacy guard idioms (isAdminClaims, currentUserIsAdmin,
 * requireAdminPage, requireEventAccess in lib/event-access.ts, the domain
 * wrappers, …) onto it, one feature area per PR.
 *
 * Roles come from tenant_memberships and platform_admins (the S3 tables);
 * Clerk is used for identity only. Until the owner flips it, AUTHZ_SOURCE
 * keeps today's behaviour:
 *
 *   clerk     (default, and any unrecognised value) decides from the Clerk
 *             session claim exactly as the legacy helpers do. No new
 *             database read for claim-only decisions.
 *   shadow    decides from Clerk, ALSO computes the postgres answer, and logs
 *             any disagreement to app_errors as 'authz_mismatch' with the
 *             members.id and route only (the repo is public: no names or
 *             emails). A failed postgres lookup is logged the same way; the
 *             Clerk answer always stands, so shadowing never denies anyone.
 *   postgres  decides from the S3 tables. Any lookup error denies (fails
 *             closed).
 *
 * The decisions themselves are pure, in lib/authz/decide.ts. The truth-table
 * harness (lib/authz/equivalence.test.ts) proves each one agrees with its
 * legacy idiom for every Stellr role, in both sources.
 */
import 'server-only'
import { cache } from 'react'
import { auth } from '@clerk/nextjs/server'
import { notFound, redirect } from 'next/navigation'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { errorDigest, routeLabel, takeWrite } from '@/lib/app-errors'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { currentTenantId } from '@/lib/authz/tenant'
import {
  anonymousPrincipal,
  authzSource,
  decideEventAccess,
  decidePlatformAdmin,
  decidePortalAccess,
  decideScope,
  decideStaffTarget,
  decideStellrAdmin,
  decideTenantRole,
  decideTenantStaff,
  eventAccessCovers,
  isUnrecognisedAuthzSource,
  roleFromClaims,
  type AuthzSource,
  type Decision,
  type DecisionSource,
  type EventAccess,
  type Principal,
  type TenantRole,
} from '@/lib/authz/decide'
import {
  AuthzLookupError,
  clerkPrincipal,
  loadAssignments,
  loadEventTenantId,
  loadMemberId,
  loadMemberships,
  loadPlatformAdmin,
  loadPostgresPrincipal,
  loadStaffScopes,
} from '@/lib/authz/principal'

export { currentTenantId } from '@/lib/authz/tenant'
// proxy.ts must import this from '@/lib/authz/decide': this module is server-only.
export { portalRoleFromClaims } from '@/lib/authz/decide'
export type { AuthzSource, Decision, EventAccess, Principal, TenantRole } from '@/lib/authz/decide'

/** Options every decision takes. `route` labels a shadow mismatch (a route pattern, never a concrete path). */
export interface AuthzOptions {
  route?: string
}

/** The configured AUTHZ_SOURCE (default 'clerk'). Read per call, so a test or redeploy can change it. */
export function getAuthzSource(): AuthzSource {
  return authzSource(process.env.AUTHZ_SOURCE)
}

/**
 * S6 support mode placeholder. In S5 every principal is 'normal', so this
 * always passes; S6 makes it refuse every mutation in 'support_read'.
 */
export function assertWritable(_principal?: Principal): void {
  // Intentionally empty in S5.
}

// ── Principals (cached per request) ────────────────────────────────────────

const clerkSession = cache(async (): Promise<Principal> => {
  const { userId, sessionClaims } = await auth()
  return clerkPrincipal(userId ?? null, roleFromClaims(sessionClaims))
})

const postgresPrincipal = cache(async (): Promise<Principal> => {
  const session = await clerkSession()
  return loadPostgresPrincipal(supabaseServer(), session.userId, session.claimsRole)
})

function principalFor(source: DecisionSource): Promise<Principal> {
  return source === 'clerk' ? clerkSession() : postgresPrincipal()
}

/**
 * The current principal for the configured source. 'clerk' and 'shadow' give
 * the claim-based principal (no database read); 'postgres' gives the
 * table-based one, or the signed-out principal when the lookup fails, so a
 * caller that only reads it fails closed.
 */
export async function getPrincipal(): Promise<Principal> {
  if (getAuthzSource() !== 'postgres') return clerkSession()
  try {
    return await postgresPrincipal()
  } catch {
    return anonymousPrincipal()
  }
}

// ── The source switch ──────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Write one rate-limited app_errors row. Never throws. */
async function recordRow(route: string, message: string, digest: string): Promise<void> {
  try {
    const count = takeWrite(digest, Date.now())
    if (count === 0) return
    const { error } = await supabaseServer().rpc('record_app_error', {
      p_digest: digest,
      p_route: route,
      p_message: message,
      p_count: count,
    })
    if (error) console.error('[authz] mismatch record failed')
  } catch {
    console.error('[authz] mismatch record failed')
  }
}

/**
 * Write one authz_mismatch row. Not captureRequestError: its scrubber turns a
 * 36-character uuid into [token], and members.id is the whole point of the row.
 * The message is built only from fixed labels and a validated uuid, so there
 * is nothing to scrub; the route still goes through routeLabel. Same rate limit
 * as every other app_errors write. errorDigest flattens uuids and a conflicting
 * row keeps its first message, so the member goes into the digest's route part:
 * each drifted member gets a row of their own, and the role-sync check before a
 * flip can list them. Never throws.
 *
 * `memberOf` names who the decision is about: the signed-in user, unless it is
 * about someone else (isStaffTarget).
 */
async function logMismatch(decision: string, detail: string, opts: AuthzOptions, memberOf: () => Promise<string | null>): Promise<void> {
  let memberId = 'unknown'
  try {
    const id = await memberOf()
    memberId = id === null ? 'none' : UUID.test(id) ? id : 'unknown'
  } catch {
    // The lookup that failed is what is being reported.
  }
  const route = routeLabel('AUTHZ', opts.route ?? 'unknown', undefined)
  const message = `authz_mismatch ${decision} member=${memberId} ${detail}`
  await recordRow(route, message, errorDigest(`${route}\n${memberId}`, message))
}

/**
 * AUTHZ_SOURCE is set to something that is not a source. It falls back to clerk;
 * after a flip that would silently restore Clerk's authority, so leave a row.
 * Fixed text only, never the value. Never throws.
 */
async function reportUnrecognisedSource(): Promise<void> {
  if (!isUnrecognisedAuthzSource(process.env.AUTHZ_SOURCE)) return
  const route = routeLabel('AUTHZ', 'config', undefined)
  const message = 'authz_source_unrecognised using=clerk'
  await recordRow(route, message, errorDigest(route, message))
}

/**
 * Run `compute` under the configured source.
 *   clerk: as is. postgres: any error returns `deny`. shadow: the clerk
 *   answer, with the postgres answer compared and any mismatch or error logged.
 */
async function decide<T>(
  name: string,
  opts: AuthzOptions,
  compute: (source: DecisionSource) => Promise<T>,
  same: (a: T, b: T) => boolean,
  deny: T,
  memberOf: () => Promise<string | null> = async () => (await postgresPrincipal()).memberId,
): Promise<T> {
  const source = getAuthzSource()
  if (source === 'clerk') {
    await reportUnrecognisedSource()
    return compute('clerk')
  }
  if (source === 'postgres') {
    try {
      return await compute('postgres')
    } catch {
      return deny
    }
  }
  const clerk = await compute('clerk')
  try {
    const pg = await compute('postgres')
    if (!same(clerk, pg)) await logMismatch(name, `clerk=${summary(clerk)} postgres=${summary(pg)}`, opts, memberOf)
  } catch (err) {
    await logMismatch(name, err instanceof AuthzLookupError ? 'lookup_failed' : 'error', opts, memberOf)
  }
  return clerk
}

function summary(v: unknown): string {
  if (typeof v === 'boolean') return String(v)
  if (v && typeof v === 'object' && 'ok' in v) {
    const d = v as { ok: boolean; status?: number; isAdmin?: boolean; assignedSlugs?: string[] | null; tenantId?: string }
    if (!d.ok) return `deny_${d.status}`
    if ('assignedSlugs' in d) {
      const reach = d.assignedSlugs === null ? 'all' : `assigned_${d.assignedSlugs?.length ?? 0}`
      return d.tenantId === STELLR_TENANT_ID ? reach : `${reach}_other_tenant`
    }
    return 'allow'
  }
  return 'unknown'
}

const sameOk = (a: { ok: boolean; status?: number }, b: { ok: boolean; status?: number }) =>
  a.ok === b.ok && (a.ok || a.status === b.status)
const sameBool = (a: boolean, b: boolean) => a === b
const DENY_403 = { ok: false, status: 403 } as const

// ── Primitives (the future BASE guards) ────────────────────────────────────

export async function assertPlatformAdmin(opts: AuthzOptions = {}): Promise<Decision> {
  return decide('platform_admin', opts, async (s) => decidePlatformAdmin(await principalFor(s), s, currentTenantId()), sameOk, DENY_403)
}

export async function assertTenantRole(tenantId: string, roles: readonly TenantRole[], opts: AuthzOptions = {}): Promise<Decision> {
  return decide('tenant_role', opts, async (s) => decideTenantRole(await principalFor(s), tenantId, roles, s), sameOk, DENY_403)
}

// ── Composites (the future DELEGATE guards) ────────────────────────────────

/** Replaces isAdminClaims / currentUserIsAdmin and the admin-only wrappers. */
export async function requireStellrAdmin(opts: AuthzOptions = {}): Promise<Decision> {
  return decide('stellr_admin', opts, async (s) => decideStellrAdmin(await principalFor(s), s), sameOk, DENY_403)
}

export async function isStellrAdmin(opts: AuthzOptions = {}): Promise<boolean> {
  return (await requireStellrAdmin(opts)).ok
}

export async function requireTenantStaff(tenantId: string, roles: readonly TenantRole[], opts: AuthzOptions = {}): Promise<Decision> {
  return decide('tenant_staff', opts, async (s) => decideTenantStaff(await principalFor(s), tenantId, roles, s), sameOk, DENY_403)
}

/** Replaces hasAdminPortalAccess: an admin or an event manager. Staff never. */
export async function hasPortalAccess(opts: AuthzOptions = {}): Promise<boolean> {
  return decide(
    'portal',
    opts,
    async (s) => decidePortalAccess(await principalFor(s), s, currentTenantId()).ok,
    sameBool,
    false,
  )
}

/**
 * Replaces lib/event-access.ts requireEventAccess, with the same return shape
 * plus the tenant the answer holds in. With a slug, the event's tenant decides
 * (postgres); without, the current tenant. Under clerk an assignment read error
 * throws, exactly as today.
 */
export async function requireEventAccess(eventSlug?: string, opts: AuthzOptions = {}): Promise<EventAccess> {
  return decide(
    'event_access',
    opts,
    async (s) => {
      const p = await principalFor(s)
      if (!p.userId) return decideEventAccess(p, { eventSlug, tenantId: currentTenantId(), assignments: [] }, s)
      const tenantId = s === 'postgres' && eventSlug ? await loadEventTenantId(supabaseServer(), eventSlug) : currentTenantId()
      const admin = decideEventAccess(p, { eventSlug, tenantId, assignments: [] }, s)
      // An admin, or someone who is not an event manager at all, needs no assignment read.
      if ((admin.ok && admin.isAdmin) || (s === 'clerk' && p.claimsRole !== 'event_manager')) return admin
      if (s === 'postgres' && !p.memberships.some((m) => m.tenantId === tenantId && m.role === 'event_manager')) return admin
      let assignments
      try {
        assignments = await loadAssignments(supabaseServer(), p.userId, s === 'postgres')
      } catch (err) {
        if (s === 'clerk') throw new Error('Failed to load event assignments')
        throw err
      }
      return decideEventAccess(p, { eventSlug, tenantId, assignments }, s)
    },
    (a, b) =>
      a.ok === b.ok &&
      (a.ok && b.ok
        ? a.isAdmin === b.isAdmin && a.tenantId === b.tenantId && JSON.stringify(a.assignedSlugs) === JSON.stringify(b.assignedSlugs)
        : !a.ok && !b.ok && a.status === b.status),
    DENY_403,
  )
}

/**
 * Does a section-level answer from requireEventAccess cover a row of this event?
 * For a route that checks the section and then loads a row by global id: the
 * row's event must be in the answer's tenant and, for an event manager, in their
 * assignments. Reads the event's tenant, and a read error is false, in every
 * source.
 */
export async function accessCoversEvent(access: EventAccess, eventSlug: string): Promise<boolean> {
  if (!access.ok) return false
  try {
    return eventAccessCovers(access, { eventSlug, tenantId: await loadEventTenantId(supabaseServer(), eventSlug) })
  } catch {
    return false
  }
}

/**
 * Replaces currentUserHasScope. Stellr only: reads staff_roles, which the S3
 * mapping does not carry, and no scope holds on another tenant's host. A read
 * error is "no scope" in every source, as today.
 */
export async function hasScope(scope: string, opts: AuthzOptions = {}): Promise<boolean> {
  return decide(
    'scope',
    opts,
    async (s) => {
      const p = await principalFor(s)
      if (!p.userId || currentTenantId() !== STELLR_TENANT_ID) return false
      if (decideStellrAdmin(p, s).ok) return true
      const db = supabaseServer()
      const memberId = s === 'postgres' ? p.memberId : await loadMemberId(db, p.userId).catch(() => null)
      if (!memberId) return false
      const scopes = await loadStaffScopes(db, memberId).catch(() => null)
      return decideScope({ ...p, memberId }, scopes, scope, s)
    },
    sameBool,
    false,
  )
}

/**
 * Is the TARGET of view-as or deletion staff? Replaces isStaffRole and the
 * duplicate set in lib/deletion/external.ts. Fails closed the protective way:
 * a lookup error under postgres counts as staff, so the action is refused. Pass
 * memberId when you have it: a target with no Clerk id can still hold
 * member-keyed rows.
 */
export async function isStaffTarget(
  target: { clerkUserId: string | null; clerkRole: unknown; memberId?: string | null },
  opts: AuthzOptions = {},
): Promise<boolean> {
  const memberOfTarget = async (): Promise<string | null> =>
    target.memberId ?? (target.clerkUserId ? loadMemberId(supabaseServer(), target.clerkUserId) : null)
  return decide(
    'staff_target',
    opts,
    async (s) => {
      // No id of either kind means no table row can be looked up, so the role is all there is.
      if (s === 'clerk' || (!target.clerkUserId && !target.memberId)) return decideStaffTarget({ clerkRole: target.clerkRole }, 'clerk')
      const db = supabaseServer()
      const memberId = await memberOfTarget()
      const [platformAdmin, memberships] = await Promise.all([
        target.clerkUserId ? loadPlatformAdmin(db, target.clerkUserId) : false,
        loadMemberships(db, target.clerkUserId, memberId),
      ])
      return decideStaffTarget({ clerkRole: target.clerkRole, platformAdmin, memberships }, s)
    },
    sameBool,
    true,
    memberOfTarget,
  )
}

// ── Adapters ───────────────────────────────────────────────────────────────

/**
 * Page adapters: the requireAdminPage behaviour. Signed out goes to /sign-in;
 * signed in without access gets notFound() (a 404 leaks less than a 403).
 */
export const page = {
  /**
   * The admin portal shell: admins and event managers. It does NOT confine an
   * event manager: proxy.ts does, and only from the Clerk claim, so under
   * postgres a claim of 'admin' with only an event_manager row passes here and
   * reaches every page using it. Before any flip, guard each page with
   * requireTenantAdmin or requireEventSection instead.
   */
  async requireAdmin(opts: AuthzOptions = {}): Promise<void> {
    const session = await clerkSession()
    if (!session.userId) redirect('/sign-in')
    if (!(await hasPortalAccess(opts))) notFound()
  },
  /** Admins of the current tenant, from the tables under postgres. Never an event manager. */
  async requireTenantAdmin(opts: AuthzOptions = {}): Promise<void> {
    const session = await clerkSession()
    if (!session.userId) redirect('/sign-in')
    if (!(await requireTenantStaff(currentTenantId(), ['tenant_admin'], opts)).ok) notFound()
  },
  /** The Events section: admins, and event managers whatever the claim says about them. */
  async requireEventSection(opts: AuthzOptions = {}): Promise<void> {
    const session = await clerkSession()
    if (!session.userId) redirect('/sign-in')
    if (!(await requireEventAccess(undefined, opts)).ok) notFound()
  },
  /** Stellr admins only. */
  async requireStellrAdmin(opts: AuthzOptions = {}): Promise<void> {
    const session = await clerkSession()
    if (!session.userId) redirect('/sign-in')
    if (!(await isStellrAdmin(opts))) notFound()
  },
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; deny: Response }

function denyResponse(status: 401 | 403): Response {
  return NextResponse.json({ error: status === 401 ? 'Unauthorised' : 'Forbidden' }, { status })
}

/**
 * API adapters: { ok, deny }. Most conversions use the predicate form instead,
 * so each route keeps its own deny response byte for byte.
 */
export const api = {
  async requireStellrAdmin(opts: AuthzOptions = {}): Promise<ApiResult<Decision & { ok: true }>> {
    const d = await requireStellrAdmin(opts)
    return d.ok ? { ok: true, value: d } : { ok: false, deny: denyResponse(d.status) }
  },
  async requireTenantStaff(tenantId: string, roles: readonly TenantRole[], opts: AuthzOptions = {}): Promise<ApiResult<Decision & { ok: true }>> {
    const d = await requireTenantStaff(tenantId, roles, opts)
    return d.ok ? { ok: true, value: d } : { ok: false, deny: denyResponse(d.status) }
  },
  async requireEventAccess(eventSlug?: string, opts: AuthzOptions = {}): Promise<ApiResult<EventAccess & { ok: true }>> {
    const a = await requireEventAccess(eventSlug, opts)
    return a.ok ? { ok: true, value: a } : { ok: false, deny: denyResponse(a.status) }
  },
}

/** Everything above under one name, for `import { authz } from '@/lib/authz'`. */
export const authz = {
  getAuthzSource,
  currentTenantId,
  getPrincipal,
  assertWritable,
  assertPlatformAdmin,
  assertTenantRole,
  requireStellrAdmin,
  isStellrAdmin,
  requireTenantStaff,
  hasPortalAccess,
  requireEventAccess,
  accessCoversEvent,
  hasScope,
  isStaffTarget,
  page,
  api,
}
