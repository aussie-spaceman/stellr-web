import { redirect } from 'next/navigation'
import { getSignedInMember } from '@/lib/community'
import { supabaseServer } from '@/lib/supabase'
import { distributionForEvent, statusNow } from '@/lib/survey/distributions'
import { onPageTenant, participantIdsFor } from '@/lib/survey/access'
import { SurveyNotice } from '@/components/survey/SurveyNotice'
import { SurveyLinkRequest } from '@/components/survey/SurveyLinkRequest'

// The event-day QR page's body, shared by Stellr's page and the tenant's.
//
// A page shows only its own tenant's survey (S5 A10b): another tenant's event answers as
// one with no survey, so its title and state are never shown and nobody signed in is sent
// to its invitation. A NULL tenant is a Stellr row the backfill has not reached. The page
// passes its tenant in, so no request is read here.

export async function EventSurveyQrBody({ slug, tenantId }: { slug: string; tenantId: string }) {
  const db = supabaseServer()
  const found = await distributionForEvent(db, slug)
  const d = found && onPageTenant(found, tenantId) ? found : null
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
