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
  eventManagers: { clerk_user_id: string }[]
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
  for (const id of new Set(input.eventManagers.map((e) => e.clerk_user_id).filter(Boolean))) wanted.push(row(id, null, 'event_manager'))
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
