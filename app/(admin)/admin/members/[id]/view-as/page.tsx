import { supabaseServer } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import { AccountProfile } from '@/components/member/AccountProfile'
import { MembershipCard } from '@/components/member/MembershipCard'
import { EventHistory } from '@/components/member/EventHistory'
import { TeamsTab } from '@/components/member/TeamsTab'
import { BillingHistory } from '@/components/member/BillingHistory'
import { DocusignsSection } from '@/components/member/DocusignsSection'
import { ViewAsBanner } from '@/components/admin/ViewAsBanner'

export const metadata = { title: 'Admin — View As Member' }

export default async function ViewAsMemberPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const db = supabaseServer()

  const [
    { data: member },
    { data: ethnicityOptions },
    { data: allergyOptions },
    { data: docusignEnvelopes },
  ] = await Promise.all([
    db
      .from('members')
      .select(`
        *,
        member_schools(*, schools(*)),
        member_memberships(*, membership_tiers(*)),
        member_ethnicities(ethnicity_option_id),
        member_allergies(allergy_option_id),
        event_participations(*)
      `)
      .eq('id', id)
      .maybeSingle(),
    db.from('ethnicity_options').select('id, name').order('name'),
    db.from('allergy_options').select('id, name').order('name'),
    db
      .from('docusign_envelopes')
      .select('id, envelope_id, status, envelope_type, signer_name, signer_email, minor_name, event_title, sent_at, completed_at, reminder_sent_at, reused_from')
      .eq('member_id', id)
      .order('sent_at', { ascending: false }),
  ])

  if (!member) notFound()

  const activeMembership = member.member_memberships
    ?.filter((m: { renewal_status: string }) => m.renewal_status === 'active')
    .sort((a: { started_at: string }, b: { started_at: string }) =>
      new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
    )[0]

  const memberName = [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email

  const showTeams = member.event_role === 'teacher' || member.event_role === 'school_student'
  const showBilling = member.event_role === 'teacher'

  return (
    <>
      {/* Banner breaks out of admin layout's padded <main> */}
      <div className="-mx-4 -mt-10 mb-8">
        <ViewAsBanner memberId={id} memberName={memberName} />
      </div>
      <div className="max-w-5xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Account</h1>
          <p className="mt-1 text-sm text-gray-500">Manage your Stellr membership and profile.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Read-only — pass no editable props */}
            <AccountProfile
              member={member}
              clerkUser={null}
              ethnicityOptions={ethnicityOptions ?? []}
              allergyOptions={allergyOptions ?? []}
              readOnly
            />
            <EventHistory participations={member.event_participations ?? []} editable={false} />
            <DocusignsSection
              initialEnvelopes={docusignEnvelopes ?? []}
              dateOfBirth={member.date_of_birth}
              eventRole={member.event_role}
              adminDownload
            />
            {showTeams && (
              <div>
                <h2 className="text-base font-semibold text-gray-900 mb-3">Teams</h2>
                <TeamsTab role={member.event_role} memberId={member.id} />
              </div>
            )}
            {showBilling && <BillingHistory />}
          </div>
          <div>
            <MembershipCard membership={activeMembership} member={member} />
          </div>
        </div>
      </div>
    </>
  )
}
