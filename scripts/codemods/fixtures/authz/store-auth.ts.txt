// Authorization gates for the web store (PRD §12).
//
// Catalog (products, variants, discounts) — platform admin only. The batch
// gates the PRD describes (event-venue → Event Manager, educator-campaign →
// owning educator) were written here but never called; removed Sept 2026.

import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'

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
