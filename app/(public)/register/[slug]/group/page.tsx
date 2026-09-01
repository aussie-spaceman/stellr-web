import { notFound } from 'next/navigation'
import { getEventBySlug } from '@/lib/sanity'
import { formatDateRange } from '@/lib/utils'
import { getRegistrationPrefill } from '@/lib/registration-prefill'
import { getEventPrice } from '@/lib/event-pricing'
import GroupRegistrationForm from '@/components/forms/GroupRegistrationForm'
import { TrackEvent } from '@/components/analytics/TrackEvent'
import { MissionFundingNote } from '@/components/ui/MissionFundingNote'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function GroupRegistrationPage({ params }: PageProps) {
  const { slug } = await params
  const event = await getEventBySlug(slug).catch(() => null)
  if (!event) notFound()

  const prefill = await getRegistrationPrefill().catch(() => null)
  const isCampaign = event.activityType === 'campaign'
  // Nothing to charge = the form skips the "how will the group pay?" question
  // entirely rather than offering three methods that all collect nothing. That
  // covers both an event with no price configured and one carrying an explicit
  // $0 price (how free events are set up). A price that exists but failed to
  // resolve is NOT free — the form keeps asking, and the API rejects the
  // registration with an actionable error rather than silently waiving a fee.
  const price = await getEventPrice(event.stripePriceId)
  const isFree = price.kind === 'free' || price.kind === 'tbc'

  return (
    <div className="min-h-screen bg-surface">
      {/* Funnel: user is filling the registration form (group). No PII. */}
      <TrackEvent
        event={{
          event: 'registration_started',
          competition_name: event.title,
          competition_id: slug,
          participation_type: isCampaign ? 'campaign' : 'event',
        }}
      />
      <div className="bg-brand-blue-dark text-white py-10 px-4">
        <div className="max-w-3xl mx-auto">
          <p className="text-blue-300 text-sm mb-4">← {isCampaign ? 'Campaign Registration' : 'Group Registration'}</p>
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">{event.title}</h1>
          {event.date && (
            <p className="text-blue-300 text-sm">
              📅 {formatDateRange(event.date, event.endDate)}
              {event.city && ` · 📍 ${event.city}${event.state ? `, ${event.state}` : ''}`}
            </p>
          )}
        </div>
      </div>

      {/* Step bar is rendered inside GroupRegistrationForm so it can reflect the current step */}

      <div className="max-w-3xl mx-auto px-4 py-10">
        <GroupRegistrationForm
          eventSlug={slug}
          eventTitle={event.title}
          prefill={prefill}
          isCampaign={isCampaign}
          isFree={isFree}
        />
        <MissionFundingNote className="mt-10" />
      </div>
    </div>
  )
}
