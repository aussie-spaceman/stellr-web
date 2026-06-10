import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, Rocket } from 'lucide-react'
import { urlFor, type StellarEvent } from '@/lib/sanity'
import { formatDateRange, registrationStatus } from '@/lib/utils'

interface EventCardProps {
  event: StellarEvent
}

const statusConfig = {
  open: { label: 'Registration Open', className: 'bg-green-100 text-green-700' },
  'coming-soon': { label: 'Coming Soon', className: 'bg-gray-100 text-gray-600' },
  closed: { label: 'Registration Closed', className: 'bg-red-100 text-red-700' },
}

export function EventCard({ event }: EventCardProps) {
  const status = registrationStatus(
    event.registrationOpen ?? false,
    event.registrationOpenDate,
    event.registrationCloseDate
  )
  const { label, className } = statusConfig[status]

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow flex flex-col">
      {/* Image */}
      <div className="relative h-44 bg-gradient-to-br from-brand-blue-dark to-blue-900 flex items-center justify-center">
        {event.image ? (
          <Image
            src={urlFor(event.image).width(600).height(352).url()}
            alt={event.title}
            fill
            className="object-cover"
          />
        ) : (
          <Rocket size={40} className="text-blue-300 opacity-60" />
        )}
      </div>

      <div className="p-5 flex flex-col flex-1">
        {/* Badges */}
        <div className="flex flex-wrap gap-2 mb-3">
          {event.gradeLevel && (
            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-blue-50 text-brand-blue">
              {event.gradeLevel}
            </span>
          )}
          {event.type && (
            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-gray-100 text-gray-600">
              {event.type}
            </span>
          )}
          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${className}`}>
            {label}
          </span>
        </div>

        <h3 className="font-bold text-brand-blue-dark mb-1 leading-snug">{event.title}</h3>

        {event.date && (
          <p className="text-sm text-brand-grey-mid">
            {formatDateRange(event.date, event.endDate)}
          </p>
        )}

        {(event.venue || event.city) && (
          <p className="text-sm text-brand-grey-mid">
            {[event.venue, event.city && event.state ? `${event.city}, ${event.state}` : event.city].filter(Boolean).join(' · ')}
          </p>
        )}

        {event.tagline && (
          <p className="mt-2 text-sm text-brand-grey-dark line-clamp-2">{event.tagline}</p>
        )}

        <div className="mt-auto pt-4">
          <Link
            href={`/events/${event.slug.current}`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-brand-blue hover:underline"
          >
            View Event <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  )
}
