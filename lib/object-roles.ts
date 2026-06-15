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

export type ObjectType = 'event' | 'group' | 'container'

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
  return !!data?.length
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
