// The legacy guards as they stood before S5 C14, frozen word for word.
//
// C14 re-implemented lib/admin-auth.ts over lib/authz. The equivalence harnesses compare
// lib/authz with the legacy answers, so with the live module on the legacy side they would
// compare lib/authz with itself and could not fail. They run this copy instead, and
// lib/authz/equivalence.test.ts holds the live module to it as well.
//
// Never edit the logic here to make a test pass: this file is what "today's answers" means.
import { auth } from '@clerk/nextjs/server'
import { notFound, redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase'

type Claims = Record<string, unknown> | null | undefined

export const STAFF_SCOPES = ['all', 'events', 'memberships', 'community', 'academy', 'graduations'] as const
export type StaffScope = (typeof STAFF_SCOPES)[number]

function roleFromClaims(sessionClaims: Claims): string | undefined {
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role
}

export function isAdminClaims(sessionClaims: Claims): boolean {
  return roleFromClaims(sessionClaims) === 'admin'
}

export function isEventManagerClaims(sessionClaims: Claims): boolean {
  return roleFromClaims(sessionClaims) === 'event_manager'
}

export const STAFF_CLERK_ROLES = ['admin', 'event_manager'] as const

export function isStaffRole(role: unknown): boolean {
  return typeof role === 'string' && (STAFF_CLERK_ROLES as readonly string[]).includes(role)
}

export async function currentUserIsAdmin(): Promise<boolean> {
  const { sessionClaims } = await auth()
  return isAdminClaims(sessionClaims)
}

export function hasAdminPortalAccess(sessionClaims: Claims): boolean {
  return isAdminClaims(sessionClaims) || isEventManagerClaims(sessionClaims)
}

export async function requireAdminPage(): Promise<void> {
  const { userId, sessionClaims } = await auth()
  if (!userId) redirect('/sign-in')
  if (!hasAdminPortalAccess(sessionClaims)) notFound()
}

export async function currentUserHasScope(scope: StaffScope): Promise<boolean> {
  const { userId, sessionClaims } = await auth()
  if (!userId) return false
  if (isAdminClaims(sessionClaims)) return true

  const db = supabaseServer()
  const { data: member } = await db.from('members').select('id').eq('clerk_user_id', userId).maybeSingle()
  if (!member) return false

  const { data } = await db.from('staff_roles').select('scopes').eq('member_id', member.id).maybeSingle()
  const scopes = (data?.scopes as string[] | null) ?? []
  return scopes.includes('all') || scopes.includes(scope)
}
