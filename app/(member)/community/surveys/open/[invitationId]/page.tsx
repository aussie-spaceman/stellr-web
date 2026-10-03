import { notFound, redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/community'
import { supabaseServer } from '@/lib/supabase'
import { invitationForMember } from '@/lib/survey/access'
import { SurveyLoader } from '@/components/survey/SurveyLoader'

export const metadata = { title: 'Survey' }
export const dynamic = 'force-dynamic'

// The survey opened from the dashboard (handover §5 "Respond via dashboard"):
// the same renderer as the email link, authorised by the member's session,
// recorded as opened_from = dashboard.
export default async function DashboardSurveyPage({ params }: { params: Promise<{ invitationId: string }> }) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up?next=/community/surveys')
  const { invitationId } = await params
  if (!/^[0-9a-f-]{36}$/.test(invitationId)) notFound()
  const inv = await invitationForMember(supabaseServer(), member.id, invitationId)
  if (!inv) notFound()
  return (
    <div className="-mx-4 sm:mx-0">
      <SurveyLoader apiBase={`/api/members/surveys/${invitationId}`} signedIn />
    </div>
  )
}
