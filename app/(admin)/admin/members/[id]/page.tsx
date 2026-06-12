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
    { data: registrations },
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
    db.from('schools').select('id, name').or('is_active.is.null,is_active.eq.true').order('name'),
    db.from('ethnicity_options').select('id, name').order('name'),
    db.from('allergy_options').select('id, name').order('name'),
    db
      .from('registrations')
      .select('id, event_title, event_slug, school_name, status, created_at, registrant_role, type')
      .eq('teacher_member_id', id)
      .order('created_at', { ascending: false }),
  ])

  if (!member) notFound()

  // The member's 7-digit Membership ID lives on their participant rows (assigned
  // by sequence on first registration). Surface the earliest one — that's the ID
  // they were given and that the confirmation email references.
  const { data: firstParticipant } = await db
    .from('participants')
    .select('membership_id')
    .or(`member_id.eq.${member.id},email.eq.${member.email}`)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  return (
    <AdminMemberDetail
      member={member}
      tiers={tiers ?? []}
      schools={schools ?? []}
      ethnicityOptions={ethnicityOptions ?? []}
      allergyOptions={allergyOptions ?? []}
      registrations={registrations ?? []}
      membershipId={(firstParticipant as { membership_id?: string } | null)?.membership_id ?? null}
    />
  )
}
