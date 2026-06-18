// Authorization gates for the web store (PRD §12).
//
// Three surfaces, three gates:
//   * Catalog (products, variants, discounts) — platform admin only.
//   * Event-venue batches — admin or the Event Manager assigned to the event
//     (reuses requireEventAccess from lib/event-access).
//   * Educator-campaign batches — admin or the educator who owns the batch
//     (reuses the team-ownership identity model from lib/team-access).

import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { requireEventAccess } from '@/lib/event-access'

// Resolve the signed-in Clerk user to their members row (id + email), or null.
export async function currentStoreMember(): Promise<{ id: string; email: string | null } | null> {
  const { userId } = await auth()
  if (!userId) return null
  const db = supabaseServer()
  const { data } = await db
    .from('members')
    .select('id, email')
    .eq('clerk_user_id', userId)
    .maybeSingle()
  return data ?? null
}

// Catalog management = platform admin.
export async function canManageStoreCatalog(): Promise<boolean> {
  const { sessionClaims } = await auth()
  return isAdminClaims(sessionClaims)
}

// Event-venue batch: admin, or the Event Manager assigned to this event.
export async function canManageEventBatch(eventSlug: string): Promise<boolean> {
  const access = await requireEventAccess(eventSlug)
  return access.ok
}

// Educator-campaign batch: admin, or the member who owns the batch.
export async function canManageEducatorBatch(ownerMemberId: string | null): Promise<boolean> {
  const { sessionClaims } = await auth()
  if (isAdminClaims(sessionClaims)) return true
  if (!ownerMemberId) return false
  const member = await currentStoreMember()
  return member?.id === ownerMemberId
}
