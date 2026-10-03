import type { Metadata } from 'next'
import { supabaseServer } from '@/lib/supabase'
import { getSignedInMember } from '@/lib/community'
import { invitationByToken, isWrongMember, loadSession } from '@/lib/survey/access'
import { formatInZone } from '@/lib/survey/timezone'
import { SurveyLoader } from '@/components/survey/SurveyLoader'
import { SurveyNotice } from '@/components/survey/SurveyNotice'
import { SurveyAfterSubmit } from '@/components/survey/SurveyAfterSubmit'

// The emailed post-event survey link (handover §5 "Respond via link"). Works
// signed out. The token is personal: it is hashed and looked up, never stored.
// No tracking loads here (lib/private-routes.ts) and the page is never cached
// or indexed (next.config.mjs).
export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Stellr survey',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function SurveyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const db = supabaseServer()
  const inv = await invitationByToken(db, token)
  if (!inv) {
    return (
      <SurveyNotice title="This link isn’t valid">
        <p>Check you used the whole link from your email. If it still doesn’t work, reply to the email and we’ll send a new one.</p>
      </SurveyNotice>
    )
  }
  const signedIn = await getSignedInMember().catch(() => null)
  if (await isWrongMember(db, inv, signedIn?.id ?? null)) {
    return (
      <SurveyNotice title="This survey belongs to someone else">
        <p>You’re signed in as a different person from the one this link was sent to. Sign out to use this link, or open your own surveys from your dashboard.</p>
      </SurveyNotice>
    )
  }
  const session = await loadSession(db, inv)
  if (!session) {
    return <SurveyNotice title="Survey unavailable"><p>This survey isn’t available any more.</p></SurveyNotice>
  }
  const title = session.distribution.event_title ?? session.distribution.event_slug

  switch (session.state) {
    case 'submitted':
      return (
        <main className="min-h-screen bg-surface px-4 py-10 sm:py-16">
          <div className="mx-auto max-w-2xl">
            <SurveyAfterSubmit eventTitle={title} signedIn={!!signedIn} justSubmitted={false} />
          </div>
        </main>
      )
    case 'closed':
      return (
        <SurveyNotice title="This survey has closed" showAccountLinks={!!signedIn}>
          <p>The {title} survey is closed. Thank you for taking part in the event.</p>
          {!signedIn && <p>Your certificate and credential are in your Stellr account. <a className="text-primary-deep underline" href="/community/credentials">Sign in or create an account</a> to see them.</p>}
        </SurveyNotice>
      )
    case 'scheduled':
      return (
        <SurveyNotice title="Not open yet">
          <p>The {title} survey opens {formatInZone(session.distribution.opens_at, session.distribution.event_time_zone)}. Come back to this link then.</p>
        </SurveyNotice>
      )
    case 'paused':
      return (
        <SurveyNotice title="Survey paused">
          <p>The {title} survey is paused for now. We’ll email you when it opens.</p>
        </SurveyNotice>
      )
    default:
      return <SurveyLoader apiBase={`/api/survey/${token}`} signedIn={!!signedIn} />
  }
}
