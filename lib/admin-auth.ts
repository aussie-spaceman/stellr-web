// The legacy guard names, as thin shims over lib/authz (S5 C14). C25 removes them; new code
// imports lib/authz. Every answer here is pinned against the pre-C14 code, kept frozen in
// test/fixtures/authz-legacy.ts, by lib/authz/equivalence.test.ts.
//
// The claim predicates take claims rather than asking for the session, so they answer from
// the claim whatever AUTHZ_SOURCE says. test/baselines/authz-legacy-idioms.json counts every
// caller, so a flip cannot be mistaken for covering them.
//
// lib/authz is `server-only`, and this file reaches operator scripts run under plain tsx
// (through lib/community and others), where that import throws at load. So it loads only when
// a guard is called, which a script never does. test/authz-load-closure.test.ts holds this.

import { auth } from '@clerk/nextjs/server'
import { notFound, redirect } from 'next/navigation'
import { PORTAL_CLERK_ROLES, decideStaffTarget, portalRoleFromClaims, type Claims } from '@/lib/authz/decide'
import { supabaseServer } from '@/lib/supabase'

// Platform RBAC function scopes (migration 044). 'all' = full admin. This is the
// seam for granular staff roles; today every admin holds 'all'.
export const STAFF_SCOPES = ['all', 'events', 'memberships', 'community', 'academy', 'graduations'] as const
export type StaffScope = (typeof STAFF_SCOPES)[number]

export function isAdminClaims(sessionClaims: Claims): boolean {
  return portalRoleFromClaims(sessionClaims) === 'admin'
}

// Event Managers get access to /admin/competitions only, and only for events
// they've been assigned to (event_manager_assignments table).
export function isEventManagerClaims(sessionClaims: Claims): boolean {
  return portalRoleFromClaims(sessionClaims) === 'event_manager'
}

// Every Clerk role that opens the admin portal.
export const STAFF_CLERK_ROLES = PORTAL_CLERK_ROLES

export function isStaffRole(role: unknown): boolean {
  return decideStaffTarget({ clerkRole: role }, 'clerk')
}

// The current request's user is a platform admin. The one-liner most
// /api/admin routes need; the claims variants above are for callers that
// already hold a session.
export async function currentUserIsAdmin(): Promise<boolean> {
  const { isStellrAdmin } = await import('@/lib/authz')
  return isStellrAdmin()
}

// Anyone allowed into the admin portal shell (nav varies by role).
export function hasAdminPortalAccess(sessionClaims: Claims): boolean {
  return portalRoleFromClaims(sessionClaims) !== null
}

// deep review AUTH-1 / AUTH-N1: page-level authorisation for admin RSC pages.
//
// The C-2 fix gates /admin in proxy.ts (middleware), which is the primary gate.
// But that made middleware the SOLE barrier: Next skips layouts on RSC
// navigation requests, so the (admin) layout check never was defence here, and
// the data pages fetch minors' PII with no guard of their own. If the matcher
// ever regresses, or a future Next release changes when middleware runs for a
// flight request, these pages would silently render again. So each admin page
// outside competitions/campaigns calls this at the top of its loader — the
// page-side twin of the /api/admin route-guard sweep (test/admin-page-guards).
//
// Fails closed: unauthenticated → sign-in; signed-in non-staff → notFound()
// (a 404 leaks less than a 403 about what exists). Event managers are allowed
// into the shell here (hasPortalAccess); the middleware is what confines
// them to competitions, exactly as the layout does for UX.
export async function requireAdminPage(): Promise<void> {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')
  const { hasPortalAccess } = await import('@/lib/authz')
  if (!(await hasPortalAccess())) notFound()
}

// Whether the current user holds a function scope. Clerk admins implicitly hold
// every scope (so existing access is unchanged); otherwise the member must have
// the scope (or 'all') granted in staff_roles. Use this to gate future
// function-scoped admin areas (e.g. graduations) without re-plumbing the gate.
//
// Not a shim over hasScope yet: lib/training.ts calls this for any member joining a live
// class, and docs/AUTHZ.md asks for a sampling decision before a call site serving members
// moves to lib/authz (shadow reads are not sampled).
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
