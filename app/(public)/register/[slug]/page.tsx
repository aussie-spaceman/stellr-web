import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Users, User, Calendar, MapPin } from 'lucide-react'
import { getEventBySlug } from '@/lib/sanity'
import { formatDateRange, registrationStatus } from '@/lib/utils'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function RegisterTypePage({ params }: PageProps) {
  const { slug } = await params
  const event = await getEventBySlug(slug).catch(() => null)
  if (!event) notFound()

  const status = registrationStatus(
    event.registrationOpen ?? false,
    event.registrationOpenDate,
    event.registrationCloseDate
  )

  if (status === 'closed') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <div className="text-5xl mb-4">🔒</div>
          <h1 className="text-2xl font-bold text-brand-blue-dark mb-2">Registration Closed</h1>
          <p className="text-gray-600 mb-6">
            Registration for <strong>{event.title}</strong> is no longer open.
          </p>
          <Link href="/events" className="btn-primary">
            Browse Other Events
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-brand-blue-dark text-white py-10 px-4">
        <div className="max-w-2xl mx-auto">
          <Link
            href={`/events/${slug}`}
            className="text-blue-300 text-sm hover:text-white transition-colors mb-4 inline-block"
          >
            ← Back to event
          </Link>
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
            <span className="w-6 h-6 rounded-full bg-brand-blue text-white flex items-center justify-center text-xs font-bold">1</span>
            <span className="font-medium text-brand-blue-dark">Registration Type</span>
            <span className="text-gray-300 mx-2">›</span>
            <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-400 flex items-center justify-center text-xs font-bold">2</span>
            <span className="text-gray-400">Your Details</span>
            <span className="text-gray-300 mx-2">›</span>
            <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-400 flex items-center justify-center text-xs font-bold">3</span>
            <span className="text-gray-400">Confirmation</span>
          </div>
        </div>
      </div>

      {/* Type selector */}
      <div className="max-w-2xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-brand-blue-dark mb-2">How are you registering?</h2>
        <p className="text-gray-600 mb-8">
          Individual students register and pay online. Teachers register a group and receive an invoice.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            href={`/register/${slug}/individual`}
            className="group bg-white rounded-xl border-2 border-gray-200 hover:border-brand-blue p-6 transition-all text-left"
          >
            <div className="w-12 h-12 rounded-full bg-blue-50 group-hover:bg-blue-100 flex items-center justify-center mb-4 transition-colors">
              <User size={22} className="text-brand-blue" />
            </div>
            <h3 className="font-bold text-brand-blue-dark text-lg mb-1">Individual</h3>
            <p className="text-sm text-gray-600 mb-4">
              I&apos;m a student registering myself. I&apos;ll pay the registration fee online.
            </p>
            <span className="text-brand-blue text-sm font-medium group-hover:underline">
              Register as Individual →
            </span>
          </Link>

          <Link
            href={`/register/${slug}/group`}
            className="group bg-white rounded-xl border-2 border-gray-200 hover:border-brand-blue p-6 transition-all text-left"
          >
            <div className="w-12 h-12 rounded-full bg-blue-50 group-hover:bg-blue-100 flex items-center justify-center mb-4 transition-colors">
              <Users size={22} className="text-brand-blue" />
            </div>
            <h3 className="font-bold text-brand-blue-dark text-lg mb-1">Group / Team</h3>
            <p className="text-sm text-gray-600 mb-4">
              I&apos;m a teacher, coach, or student manager registering a group. Choose your role in the next step.
            </p>
            <span className="text-brand-blue text-sm font-medium group-hover:underline">
              Register a Group →
            </span>
          </Link>
        </div>

        <p className="mt-8 text-xs text-gray-400 text-center">
          Already have an account?{' '}
          <a href="#" className="text-brand-blue hover:underline">
            Log in to pre-fill your details
          </a>
        </p>
      </div>
    </div>
  )
}
