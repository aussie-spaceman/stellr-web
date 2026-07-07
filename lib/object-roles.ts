// Object roles — the "manage" axis of the access model (Phase 3).
//
// Distinct from content entitlements (the "consume" axis in lib/community.ts):
// this answers "can this user MANAGE (full read/write) this object?". Resolution
// order mirrors the access schema:
//   source 1 — platform staff (RBAC) manage everything
//   source 2 — an explicit object_roles grant on this object (any member, no tier required)

import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { MANAGE_ROLES, type MemberRole } from '@/lib/member-roles'

// Legacy vocabulary ('event' slug / 'group' / 'container' uuid) plus the seven
// canonical admin/access object types (migration 125 widened the DB constraint).
export type ObjectType =
  | 'event' | 'group' | 'container'
  | 'space' | 'course' | 'workshop' | 'cohort' | 'campaign' | 'resource'

export interface ObjectRole {
  object_type: ObjectType
  object_id: string
  role: string
}

/**
 * Whether the current Clerk user may manage (objectType, objectId). Returns true
 * for platform admins (source 1) or holders of an explicit grant (source 2).
 */
export async function currentUserCanManage(
  objectType: ObjectType,
  objectId: string,
): Promise<boolean> {
  const { userId, sessionClaims } = await auth()
  if (!userId) return false
  if (isAdminClaims(sessionClaims)) return true // source 1: staff manage everything

  const db = supabaseServer()
  const { data: member } = await db
    .from('members')
    .select('id')
    .eq('clerk_user_id', userId)
    .maybeSingle()
  if (!member) return false

  const { data } = await db
    .from('object_roles')
    .select('id')
    .eq('member_id', member.id)
    .eq('object_type', objectType)
    .eq('object_id', objectId)
    .limit(1)
  if (data?.length) return true // source 2: generic object_roles manager grant

  // source 3 (complementary): an object-scoped canonical MANAGE role on this object
  // in the unified member_roles table (e.g. Moderator/Mentor/Coach).
  const { data: roles } = await db
    .from('member_roles')
    .select('role')
    .eq('member_id', member.id)
    .eq('object_type', objectType)
    .eq('object_id', objectId)
  return (roles ?? []).some((r) => MANAGE_ROLES.has((r as { role: MemberRole }).role))
}

// ─── Singleton object roles (admin/access convergence) ──────────────────────
//
// Some object types allow exactly one holder of a given role: one Coach per
// workshop, one Mentor per cohort (object_type_singleton_roles, migration 125;
// partial unique indexes on member_roles are the DB backstop). Every roster/
// manager write for these roles must call checkSingletonRoleAvailable first —
// the unified /api/admin/access endpoints do; the Add-to-roster modal mirrors
// the block client-side by naming the existing holder.

export type AccessObjectType =
  | 'space' | 'course' | 'workshop' | 'cohort' | 'event' | 'campaign' | 'resource'

/** The singleton role for an object type ('coach' | 'mentor'), or null. */
export async function singletonRoleForType(objectType: string): Promise<MemberRole | null> {
  const db = supabaseServer()
  const { data } = await db
    .from('object_type_singleton_roles')
    .select('role')
    .eq('object_type', objectType)
    .maybeSingle()
  return (data?.role as MemberRole | undefined) ?? null
}

/**
 * May `role` still be granted on this object? Checks both the unified
 * member_roles rows and the legacy structural column (mentoring_cohorts.
 * mentor_member_id carries the coach/mentor for workshops and cohorts today).
 * Returns the existing holder's id when the slot is taken.
 */
export async function checkSingletonRoleAvailable(
  objectType: string,
  objectId: string,
  role: string,
): Promise<{ ok: boolean; holderMemberId?: string }> {
  const singleton = await singletonRoleForType(objectType)
  if (!singleton || singleton !== role) return { ok: true }

  const db = supabaseServer()
  const { data: existing } = await db
    .from('member_roles')
    .select('member_id')
    .eq('object_type', objectType)
    .eq('object_id', objectId)
    .eq('role', role)
    .eq('scope', 'object')
    .limit(1)
  if (existing?.length) return { ok: false, holderMemberId: existing[0].member_id as string }

  if (objectType === 'workshop' || objectType === 'cohort') {
    const { data: container } = await db
      .from('mentoring_cohorts')
      .select('mentor_member_id')
      .eq('id', objectId)
      .maybeSingle()
    if (container?.mentor_member_id) {
      return { ok: false, holderMemberId: container.mentor_member_id as string }
    }
  }
  return { ok: true }
}

/** Every object a member manages — powers a member's "what I manage" view. */
export async function memberObjectRoles(memberId: string): Promise<ObjectRole[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('object_roles')
    .select('object_type, object_id, role')
    .eq('member_id', memberId)
  return (data ?? []) as ObjectRole[]
}

/** Grant a member manager rights over an object. Idempotent on the unique key. */
export async function grantObjectRole(
  memberId: string,
  objectType: ObjectType,
  objectId: string,
  grantedBy?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const db = supabaseServer()
  const { error } = await db.from('object_roles').upsert(
    {
      member_id: memberId,
      object_type: objectType,
      object_id: objectId,
      role: 'manager',
      granted_by: grantedBy ?? null,
    },
    { onConflict: 'member_id,object_type,object_id,role' },
  )
  if (error) {
    console.error('[object-roles] grant error:', error)
    return { ok: false, error: 'Could not grant role' }
  }
  return { ok: true }
}
