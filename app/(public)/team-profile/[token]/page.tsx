import type { Metadata } from 'next'
import { supabaseServer } from '@/lib/supabase'
import { sessionByToken } from '@/lib/team-profile/store'
import { SurveyNotice } from '@/components/survey/SurveyNotice'
import { TeamProfileForm } from '@/components/team-profile/TeamProfileForm'

// The emailed team profile link. Works signed out: the token is personal, and
// is hashed and looked up, never stored. Private route (lib/private-routes.ts):
// no tracking, never cached or indexed.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Stellr team profile',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function TeamProfilePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const session = await sessionByToken(supabaseServer(), token)
  if (!session) {
    return (
      <SurveyNotice eyebrow="Team profile" title="This link isn’t valid">
        <p>Check you used the whole link from your email. If it still doesn’t work, reply to the email and we’ll send a new one.</p>
      </SurveyNotice>
    )
  }
  if (!session.open) {
    return (
      <SurveyNotice eyebrow="Team profile" title="Team profiles are closed">
        <p>{session.eventTitle} has started, so answers can’t be changed now. See you there!</p>
      </SurveyNotice>
    )
  }
  return (
    <div className="min-h-screen bg-surface px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-2xl">
        <TeamProfileForm
          token={token}
          initial={session.answers}
          studentFirstName={session.studentFirstName}
          eventTitle={session.eventTitle}
          prefilled={session.prefilled}
          submitted={!!session.row.submitted_at}
        />
      </div>
    </div>
  )
}
