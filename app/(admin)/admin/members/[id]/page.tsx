import { supabaseServer } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import { AdminMemberDetail } from '@/components/admin/AdminMemberDetail'
import { loadComplianceForMember } from '@/lib/compliance'
import type { MemberCompliance } from '@/components/admin/MemberCompliancePanel'

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
    { data: activity },
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
    db
      .from('member_activity_log')
      .select('id, actor_type, actor_label, category, action, summary, metadata, created_at')
      .eq('member_id', id)
      .order('created_at', { ascending: false })
      .limit(30),
  ])

  if (!member) notFound()

  // Background-check / license compliance (PRD §13) — null when not required.
  const summary = await loadComplianceForMember(db, id)
  const compliance: MemberCompliance | null =
    summary && summary.state !== 'not_required'
      ? {
          state: summary.state,
          detail: summary.detail,
          license: summary.license,
          check: summary.check
            ? {
                status: summary.check.status,
                ordered_at: summary.check.ordered_at,
                expires_at: summary.check.expires_at,
                provider_report_ref: summary.check.provider_report_ref,
                includes_canceled: summary.check.includes_canceled,
              }
            : null,
        }
      : null

  // Canonical Membership ID now lives on the members row (migration 036). Fall
  // back to the member's earliest participant id if not yet backfilled.
  const canonicalId = (member as { membership_id?: string | null }).membership_id ?? null
  const { data: firstParticipant } = canonicalId
    ? { data: null }
    : await db
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
      membershipId={canonicalId ?? (firstParticipant as { membership_id?: string } | null)?.membership_id ?? null}
      activity={activity ?? []}
      compliance={compliance}
    />
  )
}
