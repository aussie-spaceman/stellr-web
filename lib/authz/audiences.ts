/**
 * Who gets staff email in a tenant (multi-tenancy plan S5, slice C9, for B17).
 * Nothing imports this yet; B17 moves lib/notify.ts, the weekly digest and the
 * event-email audiences onto it.
 *
 * Stellr keeps today's sources exactly, whatever AUTHZ_SOURCE says: staff_roles
 * scopes for staff, event_manager_assignments for managers. Those rows are read
 * even if the role mapping has not run. Another tenant has no staff_roles, so
 * its staff audience is its tenant_admin memberships, and its managers need an
 * assignment and a membership in that tenant. One tenant's audience never
 * includes another's people, and a platform admin is not implied.
 *
 * Every helper throws AuthzLookupError on a read error, so the caller can act
 * rather than send to nobody. Only a Stellr alert may fall back to the staff inbox
 * (lib/notify.ts), which is Stellr's own: on an error or an empty audience, another
 * tenant's alert goes to that tenant's own contact, or is dropped and logged. Its
 * body can hold that tenant's personal data. B17 makes this an acceptance test.
 * tenants.status is not read here: whether a suspended tenant still gets alerts
 * is for B17 to decide.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { AuthzLookupError } from './principal'
import { activeAssignmentFilter } from '@/lib/event-manager-active'

/** Member ids of a tenant's staff. For Stellr, holders of any of `scopes`; another tenant's admins carry no scopes. */
export async function staffAudienceMemberIds(db: SupabaseClient, tenantId: string, scopes: readonly string[]): Promise<string[]> {
  if (tenantId === STELLR_TENANT_ID) {
    if (scopes.length === 0) return []
    const { data, error } = await db.from('staff_roles').select('member_id').overlaps('scopes', [...scopes])
    if (error) throw new AuthzLookupError('staff_roles')
    return unique(((data ?? []) as { member_id: string | null }[]).map((r) => r.member_id))
  }
  const { data, error } = await db.from('tenant_memberships').select('member_id, clerk_user_id').eq('tenant_id', tenantId).eq('role', 'tenant_admin')
  if (error) throw new AuthzLookupError('tenant_memberships')
  const rows = (data ?? []) as { member_id: string | null; clerk_user_id: string | null }[]
  const ids = rows.map((r) => r.member_id)
  // A tenant_admin row is usually keyed by Clerk id alone.
  const clerkOnly = unique(rows.filter((r) => !r.member_id).map((r) => r.clerk_user_id))
  if (clerkOnly.length > 0) {
    const members = await db.from('members').select('id').in('clerk_user_id', clerkOnly)
    if (members.error) throw new AuthzLookupError('members')
    ids.push(...((members.data ?? []) as { id: string }[]).map((m) => m.id))
  }
  return unique(ids)
}

/** Emails of a tenant's active staff, trimmed, lower-cased and unique, as the weekly digest builds them today. */
export async function staffAudienceEmails(db: SupabaseClient, tenantId: string, scopes: readonly string[]): Promise<string[]> {
  const ids = await staffAudienceMemberIds(db, tenantId, scopes)
  if (ids.length === 0) return []
  const { data, error } = await db.from('members').select('email').in('id', ids).eq('is_active', true)
  if (error) throw new AuthzLookupError('members')
  return unique(((data ?? []) as { email: string | null }[]).map((m) => m.email?.trim().toLowerCase()))
}

/**
 * Clerk ids of the managers of an event in `tenantId`. An assignment stamped for
 * another tenant is left out, whichever tenant the caller named. Pass the event's
 * own tenant.
 */
export async function eventManagerAudienceClerkIds(db: SupabaseClient, tenantId: string, eventSlug: string): Promise<string[]> {
  const { data, error } = await db
    .from('event_manager_assignments')
    .select('clerk_user_id, tenant_id')
    .eq('event_slug', eventSlug)
    .or(activeAssignmentFilter())
  if (error) throw new AuthzLookupError('event_manager_assignments')
  const assigned = unique(
    ((data ?? []) as { clerk_user_id: string | null; tenant_id: string | null }[])
      .filter((r) => (r.tenant_id ?? STELLR_TENANT_ID) === tenantId)
      .map((r) => r.clerk_user_id),
  )
  if (tenantId === STELLR_TENANT_ID || assigned.length === 0) return assigned
  const held = await db.from('tenant_memberships').select('clerk_user_id').eq('tenant_id', tenantId).eq('role', 'event_manager').in('clerk_user_id', assigned)
  if (held.error) throw new AuthzLookupError('tenant_memberships')
  return unique(((held.data ?? []) as { clerk_user_id: string | null }[]).map((r) => r.clerk_user_id))
}

function unique(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort()
}
