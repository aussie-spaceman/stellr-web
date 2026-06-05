import { supabaseServer } from '@/lib/supabase'
import { AdminAddMember } from '@/components/admin/AdminAddMember'

export const metadata = { title: 'Admin — Add Member' }

export default async function AdminAddMemberPage() {
  const db = supabaseServer()

  const [{ data: schools }, { data: tiers }] = await Promise.all([
    db.from('schools').select('id, name').eq('is_active', true).order('name'),
    db.from('membership_tiers').select('id, name').order('sort_order'),
  ])

  return <AdminAddMember schools={schools ?? []} tiers={tiers ?? []} />
}
