import { supabaseServer } from '@/lib/supabase'
import { AdminAddMember } from '@/components/admin/AdminAddMember'

export const metadata = { title: 'Admin — Add Member' }

export default async function AdminAddMemberPage() {
  const db = supabaseServer()

  const { data: tiers } = await db
    .from('membership_tiers')
    .select('id, name')
    .order('sort_order')

  return <AdminAddMember tiers={tiers ?? []} />
}
