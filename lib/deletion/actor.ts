import { supabaseServer } from '@/lib/supabase'

// Resolves the members.id for a Clerk user, or null if there is no linked
// member row (admins are not guaranteed to have one). Used to stamp
// deleted_by / reviewed_by, both of which are nullable.
export async function memberIdForClerkUser(clerkUserId: string | null | undefined): Promise<string | null> {
  if (!clerkUserId) return null
  const db = supabaseServer()
  const { data } = await db
    .from('members')
    .select('id')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}
