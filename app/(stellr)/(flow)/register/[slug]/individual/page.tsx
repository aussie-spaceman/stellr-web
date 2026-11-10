import { TrackEvent } from '@/components/analytics/TrackEvent'
import { participationTypeFor } from '@/lib/analytics'
import { getRegistrationPrefill } from '@/lib/registration-prefill'
import { individualRegistrationBody } from './individual-body'
import { stellrRegistrationNotes } from '../stellr-notes'

interface PageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ scholarship?: string }>
}

export default async function IndividualRegistrationPage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const { scholarship: scholarshipToken } = await searchParams
  return individualRegistrationBody({
    slug,
    scholarshipToken,
    loadPrefill: () => getRegistrationPrefill().catch(() => null),
    stellrNotes: stellrRegistrationNotes(),
    // Funnel: user is filling the registration form (individual). No PII.
    funnel: (event) => (
      <TrackEvent
        event={{
          event: 'registration_started',
          competition_name: event.title,
          competition_id: slug,
          participation_type: participationTypeFor(event.activityType),
        }}
      />
    ),
  })
}
