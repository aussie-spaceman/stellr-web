import { auth } from '@clerk/nextjs/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isAdminClaims } from '@/lib/admin-auth'

// Resolves which member a /api/members/* request acts on.
//
// Normally that's the signed-in member (matched by Clerk user id). Admins may
// pass ?memberId=<uuid> to *read* another member's data — this backs the admin
// "view as member" page, which is read-only. A non-admin passing the param is
// ignored and falls through to their own record, so this grants no extra access.
//
// `columns` is the members select list the caller needs (e.g. 'id, email').
export async function resolveRequestMember<T = Record<string, unknown>>(
  req: Request,
  db: SupabaseClient,
  columns: string,
): Promise<{ member: T | null; unauthorised: boolean }> {
  const { userId, sessionClaims } = await auth()
  if (!userId) return { member: null, unauthorised: true }

  const impersonateId = new URL(req.url).searchParams.get('memberId')
  if (impersonateId && isAdminClaims(sessionClaims)) {
    const { data } = await db.from('members').select(columns).eq('id', impersonateId).maybeSingle()
    return { member: (data as T) ?? null, unauthorised: false }
  }

  const { data } = await db
    .from('members')
    .select(columns)
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()
  return { member: (data as T) ?? null, unauthorised: false }
}
