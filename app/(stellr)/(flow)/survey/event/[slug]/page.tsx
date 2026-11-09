import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSignedInMember } from '@/lib/community'
import { supabaseServer } from '@/lib/supabase'
import { distributionForEvent, statusNow } from '@/lib/survey/distributions'
import { participantIdsFor } from '@/lib/survey/access'
import { SurveyNotice } from '@/components/survey/SurveyNotice'
import { SurveyLinkRequest } from '@/components/survey/SurveyLinkRequest'

// The event-day QR code (handover §6). Never a shared survey: a signed-in
// member goes to their own invitation; anyone else gets their own link by
// email, sent only to the address it was issued to.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Event survey', robots: { index: false, follow: false }, referrer: 'no-referrer' }

export default async function EventSurveyQrPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const db = supabaseServer()
  const d = await distributionForEvent(db, slug)
  const status = d ? statusNow(d) : null
  const title = d?.event_title ?? 'this event'
  if (!d || status !== 'open') {
    return (
      <SurveyNotice title={status === 'closed' ? 'This survey has closed' : 'The survey isn’t open yet'}>
        <p>{status === 'closed' ? `The ${title} survey is closed. Thank you for taking part.` : `The ${title} survey opens on the event’s last day. Check your email then.`}</p>
      </SurveyNotice>
    )
  }

  const member = await getSignedInMember().catch(() => null)
  if (member) {
    const pids = await participantIdsFor(db, member.id)
    const or = pids.length ? `member_id.eq.${member.id},participant_id.in.(${pids.join(',')})` : `member_id.eq.${member.id}`
    const { data: inv } = await db.from('survey_invitations').select('id').eq('distribution_id', d.id).or(or).limit(1).maybeSingle()
    if (inv) redirect(`/community/surveys/open/${inv.id}?from=qr`)
  }

  return (
    <SurveyNotice title={`Tell us about ${title}`}>
      <p>Enter the email address your invitation was sent to and we’ll email you your own survey link. It takes about 5 minutes.</p>
      <SurveyLinkRequest slug={slug} />
    </SurveyNotice>
  )
}
