import { TrackEvent } from '@/components/analytics/TrackEvent'
import { confirmationBody, type ConfirmationQuery } from './confirmation-body'

interface PageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<ConfirmationQuery>
}

export default async function ConfirmationPage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const query = await searchParams
  const { id, campaign } = query
  return confirmationBody({
    slug,
    query,
    // Reaching this route is the trusted "registration succeeded" signal — the API
    // only redirects here after a successful submission. Fetch the title (non-PII)
    // for the event param; `id` is an opaque reference, never personal data.
    funnel: (event) => (
      <TrackEvent
        event={{
          event: 'registration_submitted',
          competition_name: event?.title,
          competition_id: slug,
          participation_type: campaign === '1' ? 'campaign' : 'event',
          ...(id ? { registration_ref: id } : {}),
        }}
      />
    ),
  })
}
