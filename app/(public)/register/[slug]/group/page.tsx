import { notFound } from 'next/navigation'
import { getEventBySlug } from '@/lib/sanity'
import { formatDateRange } from '@/lib/utils'
import { getRegistrationPrefill } from '@/lib/registration-prefill'
import GroupRegistrationForm from '@/components/forms/GroupRegistrationForm'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function GroupRegistrationPage({ params }: PageProps) {
  const { slug } = await params
  const event = await getEventBySlug(slug).catch(() => null)
  if (!event) notFound()

  const prefill = await getRegistrationPrefill().catch(() => null)
  const isCampaign = event.activityType === 'campaign'

  return (
    <div className="min-h-screen bg-surface">
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
        />
      </div>
    </div>
  )
}
