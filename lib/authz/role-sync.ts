/**
 * Role sync (multi-tenancy plan S5, slice C9): keeps tenant_memberships and
 * platform_admins in step with today's authorities (the Clerk role,
 * event_manager_assignments, admin_duties), so AUTHZ_SOURCE=shadow and postgres
 * have something true to read. Under the default clerk source nothing reads
 * these rows, so writing them changes no decision.
 *
 * Dual-write only. Every function here returns a result and NEVER throws: the
 * existing authority has already been written by the time one runs, and a failed
 * write here must not fail that action. The caller makes the failure visible
 * (lib/authz/role-sync-report.ts for routes, stderr for scripts), and
 * `map-tenancy-roles --check` finds whatever was missed. One case it cannot see:
 * the events mirror can miss a slug, and a miss counts as Stellr's while every
 * event is, so an assignment on such an event looks like a Stellr one. Closing
 * that is a precondition of a second tenant (lib/authz/principal.ts).
 *
 * No `.upsert()`: both unique indexes on tenant_memberships are partial, and
 * PostgREST's on_conflict cannot name an index predicate, so Postgres would
 * answer 42P10 every time. Each write reads first, inserts, and takes a 23505
 * (a concurrent writer got there) as success.
 *
 * Takes the client as an argument, and imports nothing that reads env, so
 * scripts can use it.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import type { RoleDiffInput, TenantRole } from '@/lib/tenancy/role-mapping'
import { assignedSlugsInTenant } from './decide'
import { loadAssignments, loadEventTenantId } from './principal'

/** tenant_memberships.source for a row written alongside an admin action. */
export const DUAL_WRITE_SOURCE = 'admin'

const UNIQUE_VIOLATION = '23505'

export type RoleSyncResult = { ok: true } | { ok: false; step: string; code: string }

const OK: RoleSyncResult = { ok: true }

/** A database refusal. Carries the Postgres code only: its message can echo ids or values. */
class SyncStepError extends Error {
  constructor(
    readonly step: string,
    readonly code: string,
  ) {
    super(`role sync step ${step} failed`)
  }
}

function check(step: string, error: { code?: string } | null | undefined): void {
  if (error) throw new SyncStepError(step, error.code ?? 'unknown')
}

async function guarded(step: string, run: () => Promise<void>): Promise<RoleSyncResult> {
  try {
    await run()
    return OK
  } catch (e) {
    if (e instanceof SyncStepError) return { ok: false, step: e.step, code: e.code }
    return { ok: false, step, code: 'exception' }
  }
}

/** One row per (tenant, role, key). A row found by either key counts, as planRoleMapping does. */
async function ensureMembership(
  db: SupabaseClient,
  tenantId: string,
  role: TenantRole,
  keys: { clerkUserId: string | null; memberId: string | null },
): Promise<void> {
  for (const [column, value] of [
    ['member_id', keys.memberId],
    ['clerk_user_id', keys.clerkUserId],
  ] as const) {
    if (!value) continue
    const { data, error } = await db.from('tenant_memberships').select('id').eq('tenant_id', tenantId).eq('role', role).eq(column, value).limit(1)
    check('membership_read', error)
    if ((data ?? []).length > 0) return
  }
  const { error } = await db.from('tenant_memberships').insert({
    tenant_id: tenantId,
    clerk_user_id: keys.clerkUserId,
    member_id: keys.memberId,
    role,
    source: DUAL_WRITE_SOURCE,
  })
  if (error?.code !== UNIQUE_VIOLATION) check('membership_insert', error)
}

async function removeMembership(
  db: SupabaseClient,
  tenantId: string,
  role: TenantRole,
  keys: { clerkUserId: string | null; memberId: string | null },
): Promise<void> {
  for (const [column, value] of [
    ['member_id', keys.memberId],
    ['clerk_user_id', keys.clerkUserId],
  ] as const) {
    if (!value) continue
    const { error } = await db.from('tenant_memberships').delete().eq('tenant_id', tenantId).eq('role', role).eq(column, value)
    check('membership_delete', error)
  }
}

async function memberClerkId(db: SupabaseClient, memberId: string): Promise<string | null> {
  const { data, error } = await db.from('members').select('clerk_user_id').eq('id', memberId).maybeSingle()
  check('member_read', error)
  return (data as { clerk_user_id?: string | null } | null)?.clerk_user_id ?? null
}

// ── Event managers ─────────────────────────────────────────────────────────

/**
 * A caller changes memberships only in the tenant it is authorised for. Without
 * this, an admin of one tenant could give someone a role in another by naming
 * that tenant's event. Reported as a failed sync; the membership stays as it was.
 */
function requireAuthorisedTenant(tenantId: string, authorisedTenantId: string): void {
  if (tenantId !== authorisedTenantId) throw new SyncStepError('cross_tenant', 'refused')
}

/**
 * After an assignment is written: the person holds one event_manager membership
 * in the event's tenant, however many events they manage. Every event is
 * Stellr's today, so that is Stellr's. `authorisedTenantId` is the tenant the
 * caller administers: a Clerk admin route passes Stellr.
 */
export function syncEventManagerAssigned(db: SupabaseClient, clerkUserId: string, eventSlug: string, authorisedTenantId: string): Promise<RoleSyncResult> {
  return guarded('assign', async () => {
    const tenantId = await loadEventTenantId(db, eventSlug)
    requireAuthorisedTenant(tenantId, authorisedTenantId)
    await ensureMembership(db, tenantId, 'event_manager', { clerkUserId, memberId: null })
  })
}

/**
 * After an assignment is deleted: the membership goes only with the person's
 * last assignment in that tenant. If the remaining assignments cannot be read,
 * nothing is deleted. `assignmentTenantId` is the deleted row's own tenant_id:
 * it outlives a mirror row, so the mirror is asked only when it is null.
 */
export function syncEventManagerUnassigned(
  db: SupabaseClient,
  clerkUserId: string,
  eventSlug: string,
  authorisedTenantId: string,
  assignmentTenantId: string | null,
): Promise<RoleSyncResult> {
  return guarded('unassign', async () => {
    const tenantId = assignmentTenantId ?? (await loadEventTenantId(db, eventSlug))
    requireAuthorisedTenant(tenantId, authorisedTenantId)
    const remaining = await loadAssignments(db, clerkUserId, true)
    if (assignedSlugsInTenant(remaining, tenantId).length > 0) return
    await removeMembership(db, tenantId, 'event_manager', { clerkUserId, memberId: null })
  })
}

/** An assignment's own tenant_id, read before it is deleted. Null when unset or the read failed: the mirror then answers. */
export async function loadAssignmentTenantId(db: SupabaseClient, clerkUserId: string, eventSlug: string): Promise<string | null> {
  try {
    const { data, error } = await db.from('event_manager_assignments').select('tenant_id').eq('clerk_user_id', clerkUserId).eq('event_slug', eventSlug).maybeSingle()
    return error ? null : ((data as { tenant_id?: string | null } | null)?.tenant_id ?? null)
  } catch {
    return null
  }
}

export interface EventAssignee {
  clerkUserId: string
  tenantId: string | null
}

/** An event's managers, read before the event is deleted. Null when the read failed. */
export async function loadEventAssignees(db: SupabaseClient, eventSlug: string): Promise<EventAssignee[] | null> {
  try {
    const { data, error } = await db.from('event_manager_assignments').select('clerk_user_id, tenant_id').eq('event_slug', eventSlug)
    if (error) return null
    return ((data ?? []) as { clerk_user_id: string; tenant_id: string | null }[]).map((r) => ({ clerkUserId: r.clerk_user_id, tenantId: r.tenant_id }))
  } catch {
    return null
  }
}

// ── Staff (admin_duties is Stellr's only) ───────────────────────────────────

/** After admin_duties is written. Scopes stay in admin_duties; a membership says only that the role is held. */
export function syncDutyGranted(db: SupabaseClient, memberId: string): Promise<RoleSyncResult> {
  return guarded('duty_grant', async () => {
    const clerkUserId = await memberClerkId(db, memberId)
    await ensureMembership(db, STELLR_TENANT_ID, 'duty_holder', { clerkUserId, memberId })
  })
}

/**
 * After admin_duties is deleted. Removes the row by either key, so a Clerk-keyed
 * row cannot survive the revoke. Each key is tried whatever happened to the other,
 * and the first failure is what gets reported.
 */
export function syncDutyRevoked(db: SupabaseClient, memberId: string): Promise<RoleSyncResult> {
  return guarded('duty_revoke', async () => {
    const attempts = await Promise.allSettled([
      removeMembership(db, STELLR_TENANT_ID, 'duty_holder', { clerkUserId: null, memberId }),
      memberClerkId(db, memberId).then((clerkUserId) => removeMembership(db, STELLR_TENANT_ID, 'duty_holder', { clerkUserId, memberId: null })),
    ])
    for (const attempt of attempts) {
      if (attempt.status === 'rejected') throw attempt.reason
    }
  })
}

// ── Admins (scripts/set-admin.ts) ──────────────────────────────────────────

export function syncTenantAdminGranted(db: SupabaseClient, clerkUserId: string): Promise<RoleSyncResult> {
  return guarded('admin_grant', () => ensureMembership(db, STELLR_TENANT_ID, 'tenant_admin', { clerkUserId, memberId: null }))
}

export function syncTenantAdminRevoked(db: SupabaseClient, clerkUserId: string): Promise<RoleSyncResult> {
  return guarded('admin_revoke', () => removeMembership(db, STELLR_TENANT_ID, 'tenant_admin', { clerkUserId, memberId: null }))
}

/** Owner only: scripts/set-admin.ts calls this behind --platform-admins. */
export function syncPlatformAdminGranted(db: SupabaseClient, clerkUserId: string): Promise<RoleSyncResult> {
  return guarded('platform_grant', async () => {
    const { error } = await db.from('platform_admins').insert({ clerk_user_id: clerkUserId, granted_by: 'owner' })
    if (error?.code !== UNIQUE_VIOLATION) check('platform_insert', error)
  })
}

/** Owner only: scripts/set-admin.ts calls this behind --platform-admins. */
export function syncPlatformAdminRevoked(db: SupabaseClient, clerkUserId: string): Promise<RoleSyncResult> {
  return guarded('platform_revoke', async () => {
    const { error } = await db.from('platform_admins').delete().eq('clerk_user_id', clerkUserId)
    check('platform_delete', error)
  })
}

/** Is this user in platform_admins? Null when the read failed. */
export async function isPlatformAdminRow(db: SupabaseClient, clerkUserId: string): Promise<boolean | null> {
  try {
    const { data, error } = await db.from('platform_admins').select('clerk_user_id').eq('clerk_user_id', clerkUserId).maybeSingle()
    return error ? null : Boolean(data)
  } catch {
    return null
  }
}

// ── The check's input (scripts/map-tenancy-roles.ts) ───────────────────────

export interface ClerkRoleUser {
  id: string
  role: string | undefined
}

/** Below PostgREST's max_rows, so a full page is never mistaken for a short one. */
const READ_PAGE = 500

/** Every row of a table. PostgREST's row cap is not an error, so one unpaged read can silently come back short. */
async function readAll<T>(db: SupabaseClient, table: string, columns: string, orderBy: string): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await db.from(table).select(columns).order(orderBy).range(from, from + READ_PAGE - 1)
    if (error) throw new Error(`Read failed: ${error.message}`)
    const page = (data ?? []) as unknown as T[]
    rows.push(...page)
    if (page.length < READ_PAGE) return rows
  }
}

/**
 * Everything planRoleMapping and diffRoleMapping compare. Throws on any read
 * error, so a failed read can never look like "no drift". Member Clerk ids are
 * read for duty holders only: a read of every member would stop at PostgREST's row cap
 * and drop staff off the end.
 */
export async function loadRoleInput(db: SupabaseClient, clerkUsers: readonly ClerkRoleUser[]): Promise<RoleDiffInput> {
  const [managers, duties, memberships, platform] = await Promise.all([
    readAll<RoleDiffInput['eventManagers'][number]>(db, 'event_manager_assignments', 'clerk_user_id, tenant_id', 'id'),
    readAll<{ member_id: string }>(db, 'admin_duties', 'member_id', 'member_id'),
    readAll<RoleDiffInput['existingMemberships'][number]>(db, 'tenant_memberships', 'tenant_id, clerk_user_id, member_id, role', 'id'),
    readAll<RoleDiffInput['existingPlatformAdmins'][number]>(db, 'platform_admins', 'clerk_user_id', 'clerk_user_id'),
  ])
  const dutyIds = duties.map((s) => s.member_id)
  const clerkByMember = new Map<string, string | null>()
  if (dutyIds.length > 0) {
    const members = await db.from('members').select('id, clerk_user_id').in('id', dutyIds)
    if (members.error) throw new Error(`Read failed: ${members.error.message}`)
    for (const m of (members.data ?? []) as { id: string; clerk_user_id: string | null }[]) clerkByMember.set(m.id, m.clerk_user_id)
  }
  return {
    clerkAdminIds: clerkUsers.filter((u) => u.role === 'admin').map((u) => u.id),
    clerkEventManagerIds: clerkUsers.filter((u) => u.role === 'event_manager').map((u) => u.id),
    eventManagers: managers,
    duties: dutyIds.map((id) => ({ member_id: id, clerk_user_id: clerkByMember.get(id) ?? null })),
    existingMemberships: memberships,
    existingPlatformAdmins: platform,
  }
}
