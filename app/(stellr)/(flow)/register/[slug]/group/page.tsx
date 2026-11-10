import { TrackEvent } from '@/components/analytics/TrackEvent'
import { getRegistrationPrefill } from '@/lib/registration-prefill'
import { groupRegistrationBody } from './group-body'
import { stellrRegistrationNotes } from '../stellr-notes'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function GroupRegistrationPage({ params }: PageProps) {
  const { slug } = await params
  return groupRegistrationBody({
    slug,
    loadPrefill: () => getRegistrationPrefill().catch(() => null),
    stellrNotes: stellrRegistrationNotes(),
    // Funnel: user is filling the registration form (group). No PII.
    funnel: (event) => (
      <TrackEvent
        event={{
          event: 'registration_started',
          competition_name: event.title,
          competition_id: slug,
          participation_type: event.activityType === 'campaign' ? 'campaign' : 'event',
        }}
      />
    ),
  })
}
