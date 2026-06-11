import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims, isEventManagerClaims } from '@/lib/admin-auth'

// Per-event access control for the Events section of the admin portal.
// Admins manage all events; Event Managers only events they're assigned to
// via event_manager_assignments (PRD 6.7).

export async function getAssignedEventSlugs(clerkUserId: string): Promise<string[]> {
  const db = supabaseServer()
  const { data, error } = await db
    .from('event_manager_assignments')
    .select('event_slug')
    .eq('clerk_user_id', clerkUserId)
  if (error) throw new Error(`Failed to load event assignments: ${error.message}`)
  return (data ?? []).map((row) => row.event_slug)
}

export type EventAccess =
  | { ok: true; userId: string; isAdmin: boolean; assignedSlugs: string[] | null } // null = all events
  | { ok: false; status: 401 | 403 }

// Gate for event-management pages and API routes. Pass an event slug to
// require management access to that specific event; omit it to check
// section-level access (e.g. the events list).
export async function requireEventAccess(eventSlug?: string): Promise<EventAccess> {
  const { userId, sessionClaims } = await auth()
  if (!userId) return { ok: false, status: 401 }

  if (isAdminClaims(sessionClaims)) {
    return { ok: true, userId, isAdmin: true, assignedSlugs: null }
  }

  if (!isEventManagerClaims(sessionClaims)) return { ok: false, status: 403 }

  const assignedSlugs = await getAssignedEventSlugs(userId)
  if (eventSlug && !assignedSlugs.includes(eventSlug)) {
    return { ok: false, status: 403 }
  }
  return { ok: true, userId, isAdmin: false, assignedSlugs }
}
