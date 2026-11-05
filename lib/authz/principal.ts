/**
 * Reads for lib/authz.ts (multi-tenancy plan S5, slice C1): the principal's
 * platform flag and tenant memberships, event-manager assignments and staff
 * scopes. All are platform tables read with the service-role client, never
 * through tenantDb: who holds a role is a platform fact, not tenant data.
 *
 * Every read throws AuthzLookupError on a database error, so the caller can
 * fail closed. Nothing here decides anything; lib/authz/decide.ts does.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import type { TenantRole } from '@/lib/tenancy/role-mapping'
import type { Assignment, Membership, Principal } from './decide'

/** A role lookup failed. Callers deny (postgres) or keep the clerk answer (shadow). */
export class AuthzLookupError extends Error {
  constructor(what: string) {
    // Never the database's message: it can echo ids or values.
    super(`authz lookup failed: ${what}`)
    this.name = 'AuthzLookupError'
  }
}

const TENANT_ROLES: readonly TenantRole[] = ['tenant_admin', 'event_manager', 'staff']

function isTenantRole(v: unknown): v is TenantRole {
  return typeof v === 'string' && (TENANT_ROLES as readonly string[]).includes(v)
}

/** The members.id for a Clerk user, or null when there is no member row. */
export async function loadMemberId(db: SupabaseClient, clerkUserId: string): Promise<string | null> {
  const { data, error } = await db.from('members').select('id').eq('clerk_user_id', clerkUserId).maybeSingle()
  if (error) throw new AuthzLookupError('members')
  return (data as { id?: string } | null)?.id ?? null
}

export async function loadPlatformAdmin(db: SupabaseClient, clerkUserId: string): Promise<boolean> {
  const { data, error } = await db.from('platform_admins').select('clerk_user_id').eq('clerk_user_id', clerkUserId).maybeSingle()
  if (error) throw new AuthzLookupError('platform_admins')
  return Boolean(data)
}

/**
 * Memberships held by the Clerk user or by the member row. Rows are keyed by
 * either (staff rows by member, event-manager and admin rows by Clerk id), so
 * both are read and merged. Unknown role values are dropped.
 */
export async function loadMemberships(db: SupabaseClient, clerkUserId: string | null, memberId: string | null): Promise<Membership[]> {
  const rows: { tenant_id: unknown; role: unknown }[] = []
  if (clerkUserId) {
    const byClerk = await db.from('tenant_memberships').select('tenant_id, role').eq('clerk_user_id', clerkUserId)
    if (byClerk.error) throw new AuthzLookupError('tenant_memberships')
    rows.push(...((byClerk.data as typeof rows | null) ?? []))
  }
  if (memberId) {
    const byMember = await db.from('tenant_memberships').select('tenant_id, role').eq('member_id', memberId)
    if (byMember.error) throw new AuthzLookupError('tenant_memberships')
    rows.push(...((byMember.data as typeof rows | null) ?? []))
  }
  const seen = new Set<string>()
  const out: Membership[] = []
  for (const r of rows) {
    if (typeof r.tenant_id !== 'string' || !isTenantRole(r.role)) continue
    const key = `${r.tenant_id}|${r.role}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ tenantId: r.tenant_id, role: r.role })
  }
  return out
}

/**
 * Drop memberships in a suspended or archived tenant, so suspending a tenant
 * stops its staff. Stellr is not read (no new read for Stellr's own staff, and
 * Stellr is never suspended); a tenant row that does not come back drops too.
 * For the signed-in principal only: isStaffTarget keeps them, because a
 * suspended tenant's admin is still protected from view-as and deletion.
 */
export async function dropClosedTenants(db: SupabaseClient, memberships: Membership[]): Promise<Membership[]> {
  const others = [...new Set(memberships.map((m) => m.tenantId).filter((id) => id !== STELLR_TENANT_ID))]
  if (others.length === 0) return memberships
  const { data, error } = await db.from('tenants').select('id, status').in('id', others)
  if (error) throw new AuthzLookupError('tenants')
  const open = new Set(
    ((data as { id: string; status: string }[] | null) ?? []).filter((t) => t.status !== 'suspended' && t.status !== 'archived').map((t) => t.id),
  )
  return memberships.filter((m) => m.tenantId === STELLR_TENANT_ID || open.has(m.tenantId))
}

/** The principal for the clerk source: the claim only, no database read. */
export function clerkPrincipal(userId: string | null, claimsRole: string | undefined): Principal {
  return { userId, claimsRole: userId ? claimsRole : undefined, memberId: null, platformAdmin: false, memberships: [], mode: 'normal' }
}

/**
 * The principal for the postgres source. Signed out reads nothing. Throws
 * AuthzLookupError on any database error.
 */
export async function loadPostgresPrincipal(db: SupabaseClient, userId: string | null, claimsRole: string | undefined): Promise<Principal> {
  if (!userId) return clerkPrincipal(null, undefined)
  const memberId = await loadMemberId(db, userId)
  const [platformAdmin, memberships] = await Promise.all([loadPlatformAdmin(db, userId), loadMemberships(db, userId, memberId)])
  return { userId, claimsRole, memberId, platformAdmin, memberships: await dropClosedTenants(db, memberships), mode: 'normal' }
}

/**
 * The user's event_manager_assignments. `withTenant` also reads each row's
 * derived tenant_id (postgres source); without it the read is exactly today's
 * (event_slug only) and every row counts as Stellr's.
 */
export async function loadAssignments(db: SupabaseClient, clerkUserId: string, withTenant: boolean): Promise<Assignment[]> {
  const { data, error } = await db
    .from('event_manager_assignments')
    .select(withTenant ? 'event_slug, tenant_id' : 'event_slug')
    .eq('clerk_user_id', clerkUserId)
  if (error) throw new AuthzLookupError('event_manager_assignments')
  return ((data as unknown as { event_slug: string; tenant_id?: string | null }[] | null) ?? []).map((r) => ({
    eventSlug: r.event_slug,
    tenantId: r.tenant_id ?? null,
  }))
}

/**
 * The tenant that owns an event, from the mirror. Stellr when the mirror has no
 * row or a null tenant_id. That holds only while every event is Stellr's: the
 * mirror fills by sync and can miss, so once a second tenant exists a miss must
 * deny (a precondition of that tenant, see lib/authz/decide.ts). A read error
 * THROWS. lib/events/repo.ts
 * getEventTenantId is not used here because it answers Stellr on an error too:
 * a Stellr admin would then pass on another tenant's event while the read is
 * down.
 */
export async function loadEventTenantId(db: SupabaseClient, slug: string): Promise<string> {
  const { data, error } = await db.from('events').select('tenant_id').eq('slug', slug).maybeSingle()
  if (error) throw new AuthzLookupError('events')
  return (data as { tenant_id?: string | null } | null)?.tenant_id ?? STELLR_TENANT_ID
}

/** The member's staff_roles.scopes (Stellr only), or null when none. */
export async function loadStaffScopes(db: SupabaseClient, memberId: string): Promise<string[] | null> {
  const { data, error } = await db.from('staff_roles').select('scopes').eq('member_id', memberId).maybeSingle()
  if (error) throw new AuthzLookupError('staff_roles')
  return ((data as { scopes?: string[] | null } | null)?.scopes as string[] | null) ?? null
}
