import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseServer } from '@/lib/supabase'

// ─── Canonical web-app roles (single source of truth: the member_roles table) ────
//
// The 11 canonical roles are additive on top of the base 'member'. This module is
// the read API the rest of the app migrates onto, replacing the scattered reads of
// members.event_role / community_space_members.role / session_hosts flags / etc.
// Server-only (uses the service-role client). See migration 096.

export type MemberRole =
  | 'staff' | 'coach' | 'mentor' | 'moderator' | 'student_manager'
  | 'teacher' | 'member' | 'participant' | 'volunteer' | 'donor_sponsor' | 'parent'

export type RoleScope = 'global' | 'object'

export interface MemberRoleRow {
  role: MemberRole
  scope: RoleScope
  objectType: string | null
  objectId: string | null
}

/** User-facing labels. Sentence/title case as shown to staff and members. */
export const ROLE_LABELS: Record<MemberRole, string> = {
  staff: 'Staff',
  coach: 'Coach',
  mentor: 'Mentor',
  moderator: 'Moderator',
  student_manager: 'Student Manager',
  teacher: 'Teacher',
  member: 'Member',
  participant: 'Participant',
  volunteer: 'Volunteer',
  donor_sponsor: 'Donor / Sponsor',
  parent: 'Parent',
}

/**
 * Roles that grant MANAGE (run/edit) access — the manage axis. Everything else is
 * consume/classification. 'member' is the base consume role defined by tier.
 */
export const MANAGE_ROLES: ReadonlySet<MemberRole> = new Set<MemberRole>([
  'staff', 'coach', 'mentor', 'moderator', 'student_manager', 'teacher',
])

interface RawRow {
  role: MemberRole
  scope: RoleScope
  object_type: string | null
  object_id: string | null
}

function toRow(r: RawRow): MemberRoleRow {
  return { role: r.role, scope: r.scope, objectType: r.object_type, objectId: r.object_id }
}

/** All role rows held by a member (global + object-scoped). */
export async function getMemberRoles(memberId: string): Promise<MemberRoleRow[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('member_roles')
    .select('role, scope, object_type, object_id')
    .eq('member_id', memberId)
  return ((data ?? []) as RawRow[]).map(toRow)
}

/** Distinct global role names held by a member (object-scoped roles excluded). */
export async function getGlobalRoleNames(memberId: string): Promise<MemberRole[]> {
  const rows = await getMemberRoles(memberId)
  return [...new Set(rows.filter((r) => r.scope === 'global').map((r) => r.role))]
}

/**
 * Does the member hold `role`? Pass an object to check an object-scoped grant
 * (e.g. moderator of a specific space); omit it to check a global role.
 */
export async function memberHasRole(
  memberId: string,
  role: MemberRole,
  object?: { objectType: string; objectId: string },
): Promise<boolean> {
  const db = supabaseServer()
  let q = db.from('member_roles').select('id').eq('member_id', memberId).eq('role', role)
  q = object
    ? q.eq('object_type', object.objectType).eq('object_id', object.objectId)
    : q.eq('scope', 'global')
  const { data } = await q.limit(1)
  return (data?.length ?? 0) > 0
}

/** Batch: member_id → role rows, for lists (member grids, rosters). */
export async function getRolesByMember(memberIds: string[]): Promise<Map<string, MemberRoleRow[]>> {
  const out = new Map<string, MemberRoleRow[]>()
  if (memberIds.length === 0) return out
  const db = supabaseServer()
  const { data } = await db
    .from('member_roles')
    .select('member_id, role, scope, object_type, object_id')
    .in('member_id', memberIds)
  for (const r of (data ?? []) as Array<RawRow & { member_id: string }>) {
    const arr = out.get(r.member_id) ?? []
    arr.push(toRow(r))
    out.set(r.member_id, arr)
  }
  return out
}

/**
 * Add a single GLOBAL canonical role to a member (idempotent). Used when a role is
 * granted outside registration — e.g. a member is made a mentor/coach (session host).
 * Pass the caller's db client so it shares the request's connection.
 */
export async function addGlobalRole(
  db: SupabaseClient,
  memberId: string,
  role: MemberRole,
  source = 'admin',
): Promise<void> {
  const { error } = await db
    .from('member_roles')
    .upsert(
      { member_id: memberId, role, scope: 'global' as const, source },
      { onConflict: 'member_id,role,object_type,object_id', ignoreDuplicates: true },
    )
  if (error) console.error('[member-roles] addGlobalRole error (non-fatal):', error)
}

/** event_role classification → the global canonical role(s) it implies. */
function classificationRolesFor(eventRole: string): MemberRole[] {
  switch (eventRole) {
    case 'teacher': return ['teacher']
    case 'participant': return ['participant']
    case 'school_student_manager': return ['student_manager', 'participant'] // SM counts as a participant
    case 'mentor': return ['mentor']
    case 'parent': return ['parent']
    case 'volunteer': return ['volunteer']
    case 'donor': return ['donor_sponsor']
    default: return [] // subscriber / adult → base 'member' only
  }
}

/**
 * Keep member_roles in sync with a member's registration classification. Every
 * member holds the base 'member' role plus the global role(s) their event_role
 * implies. Additive (insert-or-ignore) — call after writing members.event_role.
 * Pass the caller's db client so it shares the request's connection.
 */
export async function syncMemberClassificationRole(
  db: SupabaseClient,
  memberId: string,
  eventRole: string,
): Promise<void> {
  const roles: MemberRole[] = ['member', ...classificationRolesFor(eventRole)]
  const rows = roles.map((role) => ({
    member_id: memberId,
    role,
    scope: 'global' as const,
    source: 'registration',
  }))
  const { error } = await db
    .from('member_roles')
    .upsert(rows, { onConflict: 'member_id,role,object_type,object_id', ignoreDuplicates: true })
  if (error) console.error('[member-roles] classification sync error (non-fatal):', error)
}
