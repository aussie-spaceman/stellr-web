import { notFound } from 'next/navigation'
import { getEventBySlug } from '@/lib/sanity'
import { formatDateRange } from '@/lib/utils'
import IndividualRegistrationForm from '@/components/forms/IndividualRegistrationForm'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function IndividualRegistrationPage({ params }: PageProps) {
  const { slug } = await params
  const event = await getEventBySlug(slug).catch(() => null)
  if (!event) notFound()

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-brand-blue-dark text-white py-10 px-4">
        <div className="max-w-2xl mx-auto">
          <p className="text-blue-300 text-sm mb-4">
            ← Individual Registration
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">{event.title}</h1>
          {event.date && (
            <p className="text-blue-300 text-sm">
              📅 {formatDateRange(event.date, event.endDate)}
              {event.city && ` · 📍 ${event.city}${event.state ? `, ${event.state}` : ''}`}
            </p>
          )}
        </div>
      </div>

      {/* Step indicator */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center text-xs">✓</span>
            <span className="text-gray-400">Registration Type</span>
            <span className="text-gray-300 mx-2">›</span>
            <span className="w-6 h-6 rounded-full bg-brand-blue text-white flex items-center justify-center text-xs font-bold">2</span>
            <span className="font-medium text-brand-blue-dark">Your Details</span>
            <span className="text-gray-300 mx-2">›</span>
            <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-400 flex items-center justify-center text-xs font-bold">3</span>
            <span className="text-gray-400">Confirmation</span>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-10">
        <IndividualRegistrationForm
          eventSlug={slug}
          eventTitle={event.title}
        />
      </div>
    </div>
  )
}
