// Shared admin gate for /api/admin/* routes. Mirrors the inline
// requireAdmin check used elsewhere (role=admin in Clerk publicMetadata).

import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'

type Claims = Record<string, unknown> | null | undefined

// Platform RBAC function scopes (migration 044). 'all' = full admin. This is the
// seam for granular staff roles; today every admin holds 'all'.
export const STAFF_SCOPES = ['all', 'events', 'memberships', 'community', 'academy', 'graduations'] as const
export type StaffScope = (typeof STAFF_SCOPES)[number]

function roleFromClaims(sessionClaims: Claims): string | undefined {
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role
}

export function isAdminClaims(sessionClaims: Claims): boolean {
  return roleFromClaims(sessionClaims) === 'admin'
}

// Event Managers get access to /admin/competitions only, and only for events
// they've been assigned to (event_manager_assignments table).
export function isEventManagerClaims(sessionClaims: Claims): boolean {
  return roleFromClaims(sessionClaims) === 'event_manager'
}

// Anyone allowed into the admin portal shell (nav varies by role).
export function hasAdminPortalAccess(sessionClaims: Claims): boolean {
  return isAdminClaims(sessionClaims) || isEventManagerClaims(sessionClaims)
}

// Whether the current user holds a function scope. Clerk admins implicitly hold
// every scope (so existing access is unchanged); otherwise the member must have
// the scope (or 'all') granted in staff_roles. Use this to gate future
// function-scoped admin areas (e.g. graduations) without re-plumbing the gate.
export async function currentUserHasScope(scope: StaffScope): Promise<boolean> {
  const { userId, sessionClaims } = await auth()
  if (!userId) return false
  if (isAdminClaims(sessionClaims)) return true // platform admin = all scopes

  const db = supabaseServer()
  const { data: member } = await db
    .from('members')
    .select('id')
    .eq('clerk_user_id', userId)
    .maybeSingle()
  if (!member) return false

  const { data } = await db
    .from('staff_roles')
    .select('scopes')
    .eq('member_id', member.id)
    .maybeSingle()
  const scopes = (data?.scopes as string[] | null) ?? []
  return scopes.includes('all') || scopes.includes(scope)
}
