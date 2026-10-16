import Link from 'next/link'
import { ArrowRight, Rocket } from 'lucide-react'
import type { StellarEvent } from '@/lib/sanity'
import { sanityImage } from '@/lib/sanity-image'
import { CoverImage, CARD_IMAGE_SIZES } from '@/components/ui/CoverImage'
import { formatDate, formatDateRange, eventLastDay, registrationStatus } from '@/lib/utils'
import { CardPills } from '@/components/ui/CardPills'
import { gradeBand } from '@/lib/grade-band'

interface EventCardProps {
  event: StellarEvent
  /** The image's `sizes`: the grid the card sits in. Defaults to the /events board. */
  imageSizes?: string
}

const statusConfig = {
  open: { label: 'Registration Open', className: 'bg-green-100 text-green-700' },
  'coming-soon': { label: 'Coming Soon', className: 'bg-surface text-content-body' },
  closed: { label: 'Registration Closed', className: 'bg-red-100 text-red-700' },
}

export function EventCard({ event, imageSizes = CARD_IMAGE_SIZES.eventsBoard }: EventCardProps) {
  const status = registrationStatus(event.registrationOpenDate, event.registrationCloseDate, eventLastDay(event))
  const { label, className } = statusConfig[status]

  return (
    <div className="bg-white rounded-xl shadow-sm border border-line-light overflow-hidden hover:shadow-md transition-shadow flex flex-col">
      {/* Image */}
      <div className="relative h-44 bg-gradient-to-br from-brand-blue-dark to-blue-900 flex items-center justify-center">
        {event.image ? (
          <CoverImage image={sanityImage(event.image, 'card', imageSizes)} alt={event.title} />
        ) : (
          <Rocket size={40} className="text-blue-300 opacity-60" />
        )}
      </div>

      <div className="p-5 flex flex-col flex-1">
        {/* Standardised three-pill row (Event · Grade · Theme) + status */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <CardPills kind="event" gradeLevel={gradeBand(event).label} type={event.type} />
          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${className}`}>
            {label}
          </span>
        </div>

        <h3 className="font-bold text-brand-blue-dark mb-1 leading-snug">{event.title}</h3>

        {event.date && (
          <p className="text-sm text-content-muted">
            {formatDateRange(event.date, event.endDate)}
          </p>
        )}

        {(event.venue || event.city) && (
          <p className="text-sm text-content-muted">
            {[event.venue, event.city && event.state ? `${event.city}, ${event.state}` : event.city].filter(Boolean).join(' · ')}
          </p>
        )}

        {event.tagline && (
          <p className="mt-2 text-sm text-brand-grey-dark line-clamp-2">{event.tagline}</p>
        )}

        <div className="mt-auto pt-4">
          {status === 'open' ? (
            <>
              <div className="flex items-center gap-4">
                <Link href={`/register/${event.slug.current}`} className="btn-energy !px-4 !py-2">
                  Register Now
                </Link>
                <Link
                  href={`/events/${event.slug.current}`}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-brand-blue hover:underline"
                >
                  Event details <ArrowRight size={14} />
                </Link>
              </div>
              {event.registrationCloseDate && (
                <p className="mt-2 text-xs text-content-muted">
                  Registration closes {formatDate(event.registrationCloseDate)}
                </p>
              )}
            </>
          ) : (
            <Link
              href={`/events/${event.slug.current}`}
              className="inline-flex items-center gap-1 text-sm font-semibold text-brand-blue hover:underline"
            >
              View Event <ArrowRight size={14} />
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
