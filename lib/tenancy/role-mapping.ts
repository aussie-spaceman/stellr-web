/**
 * Role mapping (multi-tenancy plan S3): today's roles, written into the new
 * tenancy tables as DATA. Nothing reads these rows for authority yet — the
 * Clerk `role` claim, staff_roles and event_manager_assignments remain what
 * every guard checks until S5. Pure: scripts/map-tenancy-roles.ts does the I/O.
 *
 *   Clerk admin (public_metadata.role = 'admin')
 *       -> platform_admins            (OWNER ACTION, separate flag)
 *       -> tenant_memberships tenant_admin for Stellr
 *   event_manager_assignments.clerk_user_id
 *       -> tenant_memberships event_manager for Stellr (one per person, not per event)
 *   staff_roles.member_id
 *       -> tenant_memberships staff for Stellr (keyed by member, with the
 *          member's Clerk id when it has one)
 *
 * S5 C9 keeps the rows in step with those authorities: lib/authz/role-sync.ts
 * dual-writes them, and diffRoleMapping below is what `map-tenancy-roles --check`
 * reports. An assignment on another tenant's event never becomes a Stellr
 * membership.
 */
import { STELLR_TENANT_ID } from './constants'

export type TenantRole = 'tenant_admin' | 'event_manager' | 'staff'

export interface MembershipRow {
  tenant_id: string
  clerk_user_id: string | null
  member_id: string | null
  role: TenantRole
  source: string
}

export interface RoleMappingInput {
  clerkAdminIds: string[]
  /** tenant_id is the row's derived tenant; null or absent counts as Stellr's, as in lib/authz/decide.ts. */
  eventManagers: { clerk_user_id: string; tenant_id?: string | null }[]
  staff: { member_id: string; clerk_user_id: string | null }[]
  existingMemberships: { tenant_id: string; clerk_user_id: string | null; member_id: string | null; role: string }[]
  existingPlatformAdmins: { clerk_user_id: string }[]
}

export interface RoleMappingPlan {
  platformAdmins: string[]
  memberships: MembershipRow[]
  alreadyPresent: number
}

export const MAPPING_SOURCE = 'role_mapping'

function managersInTenant(rows: RoleMappingInput['eventManagers'], tenantId: string): string[] {
  return rows.filter((e) => e.clerk_user_id && (e.tenant_id ?? STELLR_TENANT_ID) === tenantId).map((e) => e.clerk_user_id)
}

export function planRoleMapping(input: RoleMappingInput, tenantId: string = STELLR_TENANT_ID): RoleMappingPlan {
  const haveAdmin = new Set(input.existingPlatformAdmins.map((p) => p.clerk_user_id))
  const platformAdmins = [...new Set(input.clerkAdminIds.filter(Boolean))].filter((id) => !haveAdmin.has(id)).sort()

  const key = (m: { tenant_id: string; clerk_user_id: string | null; member_id: string | null; role: string }) =>
    m.member_id ? `${m.tenant_id}|m:${m.member_id}|${m.role}` : `${m.tenant_id}|c:${m.clerk_user_id}|${m.role}`
  const haveClerk = new Set(
    input.existingMemberships.filter((m) => m.clerk_user_id).map((m) => `${m.tenant_id}|c:${m.clerk_user_id}|${m.role}`),
  )
  const haveMember = new Set(
    input.existingMemberships.filter((m) => m.member_id).map((m) => `${m.tenant_id}|m:${m.member_id}|${m.role}`),
  )

  const wanted: MembershipRow[] = []
  const row = (clerk: string | null, member: string | null, role: TenantRole): MembershipRow => ({
    tenant_id: tenantId,
    clerk_user_id: clerk,
    member_id: member,
    role,
    source: MAPPING_SOURCE,
  })
  for (const id of new Set(input.clerkAdminIds.filter(Boolean))) wanted.push(row(id, null, 'tenant_admin'))
  for (const id of new Set(managersInTenant(input.eventManagers, tenantId))) wanted.push(row(id, null, 'event_manager'))
  const seenStaff = new Set<string>()
  for (const s of input.staff) {
    if (!s.member_id || seenStaff.has(s.member_id)) continue
    seenStaff.add(s.member_id)
    wanted.push(row(s.clerk_user_id ?? null, s.member_id, 'staff'))
  }

  const memberships: MembershipRow[] = []
  let alreadyPresent = 0
  const planned = new Set<string>()
  for (const m of wanted) {
    const exists =
      (m.clerk_user_id && haveClerk.has(`${m.tenant_id}|c:${m.clerk_user_id}|${m.role}`)) ||
      (m.member_id && haveMember.has(`${m.tenant_id}|m:${m.member_id}|${m.role}`))
    if (exists) {
      alreadyPresent++
      continue
    }
    const k = key(m)
    if (planned.has(k)) continue
    planned.add(k)
    memberships.push(m)
  }
  const order = (m: MembershipRow) => `${m.role}|${m.member_id ?? ''}|${m.clerk_user_id ?? ''}`
  memberships.sort((a, b) => order(a).localeCompare(order(b)))
  return { platformAdmins, memberships, alreadyPresent }
}

// ── Drift (S5 C9) ───────────────────────────────────────────────────────────

export interface RoleDiffInput extends RoleMappingInput {
  /** Clerk users whose public_metadata.role is 'event_manager'. */
  clerkEventManagerIds: string[]
}

export interface StaleMembership {
  clerk_user_id: string | null
  member_id: string | null
  role: string
}

export interface RoleDrift {
  /** Today's authorities say this row should exist, and it does not. */
  missing: MembershipRow[]
  /** This tenant's row has no authority behind it any more. */
  stale: StaleMembership[]
  /** In platform_admins without the Clerk admin role. */
  platformAdminsWithoutClerkAdmin: string[]
  /** The Clerk event_manager role with no assignment in this tenant: the role opens the portal, a membership would not exist. */
  claimWithoutAssignment: string[]
  /** An assignment in this tenant with no portal role in Clerk: the role denies them, a membership would admit them. */
  assignmentWithoutClaim: string[]
  /** Another tenant's event_manager role and assignments that disagree. decideEventAccess needs both. */
  otherTenantManagers: OtherTenantManagerDrift[]
  /** NOT drift. Clerk admins not in platform_admins: --platform-admins is the owner's own decision. */
  clerkAdminsNotPlatform: string[]
}

export interface OtherTenantManagerDrift {
  tenant_id: string
  clerk_user_id: string | null
  kind: 'assignment_without_membership' | 'membership_without_assignment'
}

/** event_manager_assignments is the one legacy authority that spans tenants, so these rows can be checked for all of them. */
function otherTenantManagerDrift(input: RoleDiffInput, tenantId: string): OtherTenantManagerDrift[] {
  const pair = (tenant: string, clerk: string | null) => `${tenant}|${clerk}`
  const assigned = new Map<string, OtherTenantManagerDrift>()
  for (const e of input.eventManagers) {
    const tenant = e.tenant_id ?? STELLR_TENANT_ID
    if (tenant !== tenantId && e.clerk_user_id) assigned.set(pair(tenant, e.clerk_user_id), { tenant_id: tenant, clerk_user_id: e.clerk_user_id, kind: 'assignment_without_membership' })
  }
  const held = new Map<string, OtherTenantManagerDrift>()
  for (const m of input.existingMemberships) {
    if (m.role === 'event_manager' && m.tenant_id !== tenantId) held.set(pair(m.tenant_id, m.clerk_user_id), { tenant_id: m.tenant_id, clerk_user_id: m.clerk_user_id, kind: 'membership_without_assignment' })
  }
  return [...[...assigned].filter(([k]) => !held.has(k)), ...[...held].filter(([k]) => !assigned.has(k))]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, row]) => row)
}

/**
 * Where tenant_memberships and platform_admins disagree with today's
 * authorities. `tenantId`'s rows are compared in full. For any other tenant only
 * event_manager rows and assignments are: nothing else there has a legacy
 * authority. A row matches by either key, as planRoleMapping and
 * lib/authz/principal.ts do.
 */
export function diffRoleMapping(input: RoleDiffInput, tenantId: string = STELLR_TENANT_ID): RoleDrift {
  const plan = planRoleMapping(input, tenantId)
  const admins = new Set(input.clerkAdminIds.filter(Boolean))
  const claimManagers = new Set(input.clerkEventManagerIds.filter(Boolean))
  const managers = new Set(managersInTenant(input.eventManagers, tenantId))
  const staffMembers = new Set(input.staff.map((s) => s.member_id).filter(Boolean))
  const staffClerks = new Set(input.staff.map((s) => s.clerk_user_id).filter(Boolean))

  const backed = (m: StaleMembership): boolean => {
    if (m.role === 'tenant_admin') return !!m.clerk_user_id && admins.has(m.clerk_user_id)
    if (m.role === 'event_manager') return !!m.clerk_user_id && managers.has(m.clerk_user_id)
    if (m.role === 'staff') return (!!m.member_id && staffMembers.has(m.member_id)) || (!!m.clerk_user_id && staffClerks.has(m.clerk_user_id))
    return false
  }
  const stale = input.existingMemberships
    .filter((m) => m.tenant_id === tenantId && !backed(m))
    .map((m) => ({ clerk_user_id: m.clerk_user_id, member_id: m.member_id, role: m.role }))
    .sort((a, b) => `${a.role}|${a.member_id ?? ''}|${a.clerk_user_id ?? ''}`.localeCompare(`${b.role}|${b.member_id ?? ''}|${b.clerk_user_id ?? ''}`))

  const platform = new Set(input.existingPlatformAdmins.map((p) => p.clerk_user_id))
  return {
    missing: plan.memberships,
    stale,
    platformAdminsWithoutClerkAdmin: [...platform].filter((id) => !admins.has(id)).sort(),
    claimWithoutAssignment: [...claimManagers].filter((id) => !managers.has(id)).sort(),
    assignmentWithoutClaim: [...managers].filter((id) => !admins.has(id) && !claimManagers.has(id)).sort(),
    otherTenantManagers: otherTenantManagerDrift(input, tenantId),
    clerkAdminsNotPlatform: plan.platformAdmins,
  }
}

/** How many disagreements `--check` fails on. clerkAdminsNotPlatform is not one. */
export function roleDriftCount(d: RoleDrift): number {
  return (
    d.missing.length +
    d.stale.length +
    d.platformAdminsWithoutClerkAdmin.length +
    d.claimWithoutAssignment.length +
    d.assignmentWithoutClaim.length +
    d.otherTenantManagers.length
  )
}

/** The `--check` report, one line per disagreement. It holds account ids, so it stays off the repo. */
export function formatRoleDrift(d: RoleDrift): string[] {
  const who = (m: { clerk_user_id: string | null; member_id: string | null }) => `clerk=${m.clerk_user_id ?? '-'} member=${m.member_id ?? '-'}`
  return [
    ...d.missing.map((m) => `missing membership      ${m.role.padEnd(13)} ${who(m)}`),
    ...d.stale.map((m) => `stale membership        ${m.role.padEnd(13)} ${who(m)}`),
    ...d.platformAdminsWithoutClerkAdmin.map((id) => `platform admin, no Clerk admin role      clerk=${id}`),
    ...d.claimWithoutAssignment.map((id) => `Clerk event_manager role, no assignment  clerk=${id}`),
    ...d.assignmentWithoutClaim.map((id) => `assignment, no Clerk portal role         clerk=${id}`),
    ...d.otherTenantManagers.map((m) => `other tenant, ${m.kind.replaceAll('_', ' ').padEnd(29)} tenant=${m.tenant_id} clerk=${m.clerk_user_id ?? '-'}`),
  ]
}

// ── Where the dual-write may go (S5 C9) ─────────────────────────────────────

export type DualWriteTarget = { write: true } | { write: false; reason: string }

/**
 * Whether scripts/set-admin.ts may write memberships next to its Clerk change.
 * The Clerk change never depends on this. The same two refusals as
 * map-tenancy-roles: Supabase and Clerk from different environments would write
 * one environment's user id into the other's table, and production needs its flag.
 */
export function dualWriteTarget(env: {
  hasDbCredentials: boolean
  isProductionDb: boolean
  clerkLive: boolean
  productionFlag: boolean
}): DualWriteTarget {
  if (!env.hasDbCredentials) return { write: false, reason: 'no Supabase URL or secret key in this environment' }
  if (env.isProductionDb !== env.clerkLive) return { write: false, reason: 'Supabase and Clerk point at different environments' }
  if (env.isProductionDb && !env.productionFlag) return { write: false, reason: 'this is PRODUCTION and --production was not passed' }
  return { write: true }
}

/**
 * What set-admin tells the operator when the Clerk change went through and the
 * Postgres row did not. A revoke is not refused for this: Clerk is the authority
 * today, and removing someone's access must not wait on a second system.
 */
export function dualWriteConsequence(revoke: boolean): string {
  return revoke
    ? 'The Clerk role is removed. Under AUTHZ_SOURCE=postgres this person KEEPS access until the row is removed.'
    : 'The Clerk role is granted and stays. Under AUTHZ_SOURCE=postgres this person has no access until the row is written.'
}
