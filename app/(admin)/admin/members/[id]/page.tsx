import { supabaseServer } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import { AdminMemberDetail } from '@/components/admin/AdminMemberDetail'

export const metadata = { title: 'Admin — Member Detail' }

export default async function AdminMemberPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const db = supabaseServer()

  const { data: member } = await db
    .from('members')
    .select(`
      *,
      member_memberships(*, membership_tiers(*)),
      member_schools(*, schools(*)),
      member_ethnicities(*, ethnicity_options(*)),
      member_allergies(*, allergy_options(*)),
      event_participations(*)
    `)
    .eq('id', id)
    .maybeSingle()

  if (!member) notFound()

  const { data: tiers } = await db
    .from('membership_tiers')
    .select('id, name')
    .order('sort_order')

  const { data: schools } = await db
    .from('schools')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  return (
    <AdminMemberDetail member={member} tiers={tiers ?? []} schools={schools ?? []} />
  )
}
