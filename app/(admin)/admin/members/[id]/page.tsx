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

  const [
    { data: member },
    { data: tiers },
    { data: schools },
    { data: ethnicityOptions },
    { data: allergyOptions },
  ] = await Promise.all([
    db
      .from('members')
      .select(`
        *,
        member_memberships(*, membership_tiers(*)),
        member_schools(*, schools(*)),
        member_ethnicities(ethnicity_option_id),
        member_allergies(allergy_option_id),
        event_participations(*)
      `)
      .eq('id', id)
      .maybeSingle(),
    db.from('membership_tiers').select('id, name').order('sort_order'),
    db.from('schools').select('id, name').eq('is_active', true).order('name'),
    db.from('ethnicity_options').select('id, name').order('name'),
    db.from('allergy_options').select('id, name').order('name'),
  ])

  if (!member) notFound()

  return (
    <AdminMemberDetail
      member={member}
      tiers={tiers ?? []}
      schools={schools ?? []}
      ethnicityOptions={ethnicityOptions ?? []}
      allergyOptions={allergyOptions ?? []}
    />
  )
}
