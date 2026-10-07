import { supabaseServer } from '@/lib/supabase'
import { AdminAddMember } from '@/components/admin/AdminAddMember'

export const metadata = { title: 'Admin — Add Member' }

// ?return=/admin/… sends the admin back where they came from after saving —
// e.g. the Educator PD panel, to issue the new teacher's credential. Only
// admin-relative paths are honoured.
export default async function AdminAddMemberPage({ searchParams }: { searchParams: Promise<{ return?: string }> }) {
  const { return: back } = await searchParams
  const returnTo = back && back.startsWith('/admin/') && !back.startsWith('//') ? back : null
  const db = supabaseServer()

  const { data: tiers } = await db
    .from('membership_tiers')
    .select('id, name')
    .order('sort_order')

  return <AdminAddMember tiers={tiers ?? []} returnTo={returnTo} />
}
