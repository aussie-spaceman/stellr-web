import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MapPin, Calendar, Users } from 'lucide-react'
import { getEventBySlug, urlFor, wmSrc, type StellarEvent } from '@/lib/sanity'
import { formatDateRange, formatDate, registrationStatus } from '@/lib/utils'
import { PortableText } from 'next-sanity'
import type { PortableTextBlock } from '@portabletext/types'

export const revalidate = 3600

interface EventData extends StellarEvent {
  description?: PortableTextBlock[]
  capacity?: number
  eligibility?: string
  schedule?: { time?: string; label?: string }[]
}

interface PageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const event: EventData | null = await getEventBySlug(slug).catch(() => null)
  if (!event) return { title: 'Event Not Found' }
  return {
    title: event.title,
    description: event.tagline,
    openGraph: event.image
      ? { images: [{ url: urlFor(event.image).width(1200).height(630).url() }] }
      : undefined,
  }
}

const statusConfig = {
  open: { label: 'Registration Open', className: 'bg-green-100 text-green-700 border-green-200' },
  'coming-soon': { label: 'Coming Soon', className: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  closed: { label: 'Registration Closed', className: 'bg-red-50 text-red-700 border-red-200' },
}

// Theme → pill colour (Space = purple, Environmental = green). Falls back to the
// neutral hero chip for any other/legacy theme value.
const THEME_PILL: Record<string, string> = {
  'Environmental Design Challenge': 'bg-enviro-green-chip text-enviro-green-text',
  'Space Design Challenge': 'bg-space-violet-chip text-space-violet-text',
}

const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: 'What should my team bring on the day?',
    a: 'All competition material is provided, along with snacks and meals. Bring pens, notebooks, and general school work material. We recommend bringing a laptop or tablet if you have access to one — you will not be disadvantaged if you don’t.',
  },
  {
    q: 'How many students can be on a team?',
    a: 'This varies by competition, and by the final number of participants. Both individuals and groups can register.',
  },
  {
    q: 'Is there a cost to participate?',
    a: (
      <>
        Registration fees vary by event. If you wish to attend but can’t afford the fees, please look at our{' '}
        <Link href="/scholarship" className="text-brand-blue font-medium hover:underline">
          scholarship page
        </Link>
        .
      </>
    ),
  },
  {
    q: 'What happens if I can’t attend after registering?',
    a: (
      <>
        Please notify us as soon as possible. Review our{' '}
        <Link href="/terms#refunds" className="text-brand-blue font-medium hover:underline">
          Terms of Service
        </Link>{' '}
        for specifics.
      </>
    ),
  },
]

export default async function EventDetailPage({ params }: PageProps) {
  const { slug } = await params
  const event: EventData | null = await getEventBySlug(slug).catch(() => null)
  if (!event) notFound()

  const status = registrationStatus(event.registrationOpenDate, event.registrationCloseDate)
  const { label: statusLabel, className: statusClass } = statusConfig[status]

  // JSON-LD for this event
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    startDate: event.date,
    endDate: event.endDate ?? event.date,
    location: {
      '@type': 'Place',
      name: event.venue,
      address: `${event.city}, ${event.state}`,
    },
    organizer: { '@type': 'Organization', name: 'Stellr Education' },
    url: `https://www.stellreducation.org/events/${slug}`,
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative bg-brand-blue-dark text-white">
        {event.image && (
          <div className="relative h-72 sm:h-96">
            <Image
              src={wmSrc(urlFor(event.image).width(1400).height(600).url())}
              alt={event.title}
              fill
              className="object-cover opacity-40"
              priority
            />
          </div>
        )}

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12 pt-8">
          {/* Badges */}
          <div className="flex flex-wrap gap-2 mb-4">
            {event.gradeLevel && (
              <span className="text-xs font-semibold px-3 py-1 rounded-full bg-blue-600/40 text-blue-200">
                {event.gradeLevel}
              </span>
            )}
            {event.type && (
              <span className={`text-xs font-semibold px-3 py-1 rounded-full ${THEME_PILL[event.type] ?? 'bg-white/10 text-content-faint'}`}>
                {event.type}
              </span>
            )}
            <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${statusClass}`}>
              {statusLabel}
            </span>
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold leading-tight mb-3">
            {event.title}
          </h1>

          {event.date && (
            <p className="text-blue-300 text-lg mb-1">
              📅 {formatDateRange(event.date, event.endDate)}
            </p>
          )}

          {(event.venue || event.city) && (
            <p className="text-blue-300 text-lg">
              📍 {[event.venue, event.city && event.state ? `${event.city}, ${event.state}` : event.city].filter(Boolean).join(' · ')}
            </p>
          )}

          {/* Hero CTAs */}
          <div className="mt-8 flex flex-wrap gap-4">
            <a
              href={`/register/${slug}`}
              className="btn-primary text-base px-8 py-4"
            >
              Register Now
            </a>
          </div>
        </div>
      </section>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <section className="section-padding">
        <div className="container-max">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">

            {/* Left: description */}
            <div className="lg:col-span-2 space-y-8">
              {/* Tagline */}
              {event.tagline && (
                <blockquote className="border-l-4 border-brand-blue pl-6 text-xl font-medium italic text-brand-grey-dark">
                  {event.tagline}
                </blockquote>
              )}

              {/* Rich text description */}
              {event.description ? (
                <div className="prose prose-slate max-w-none">
                  <PortableText value={event.description} />
                </div>
              ) : (
                <div className="prose prose-slate max-w-none text-brand-grey-dark space-y-4">
                  <p>
                    This is a Stellr {event.type} — a high-tempo, industry-simulation competition
                    where student teams tackle real-world design challenges mentored by industry professionals.
                  </p>
                  <p>
                    Teams will present their solutions to a panel of expert judges from aerospace,
                    engineering, and science industries. Full event brief will be released closer to the date.
                  </p>
                  <p>
                    <em>Full event description coming soon. Check back or subscribe to our newsletter for updates.</em>
                  </p>
                </div>
              )}

              {/* Schedule — from Sanity; hidden entirely when none is entered */}
              {event.schedule && event.schedule.length > 0 && (
                <div>
                  <h2 className="text-2xl font-bold text-brand-blue-dark mb-4">Schedule</h2>
                  <div className="space-y-3">
                    {event.schedule.map((item, i) => (
                      <div key={i} className="flex gap-4 text-sm">
                        <span className="font-mono text-brand-grey-mid w-40 shrink-0">{item.time}</span>
                        <span className="text-brand-grey-dark">{item.label}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-brand-grey-mid italic">Schedule is indicative — full timetable released 2 weeks before event.</p>
                </div>
              )}

              {/* FAQ accordion */}
              <div>
                <h2 className="text-2xl font-bold text-brand-blue-dark mb-4">Frequently Asked Questions</h2>
                <div className="space-y-3">
                  {FAQS.map((faq) => (
                    <details key={faq.q} className="group border border-line rounded-lg">
                      <summary className="flex items-center justify-between p-4 cursor-pointer font-medium text-brand-blue-dark list-none">
                        {faq.q}
                        <span className="ml-4 shrink-0 text-brand-grey-mid group-open:rotate-180 transition-transform">▾</span>
                      </summary>
                      <p className="px-4 pb-4 text-sm text-brand-grey-dark">{faq.a}</p>
                    </details>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: details panel */}
            <aside className="space-y-6">
              <div className="bg-brand-grey-light rounded-xl p-6 space-y-4">
                <h2 className="text-lg font-bold text-brand-blue-dark">Event Details</h2>

                {event.date && (
                  <div className="flex items-start gap-3">
                    <Calendar size={18} className="text-brand-blue mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-brand-blue-dark">Date</p>
                      <p className="text-sm text-brand-grey-dark">{formatDateRange(event.date, event.endDate)}</p>
                    </div>
                  </div>
                )}

                {(event.venue || event.city) && (
                  <div className="flex items-start gap-3">
                    <MapPin size={18} className="text-brand-blue mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-brand-blue-dark">Venue</p>
                      {event.venue && <p className="text-sm text-brand-grey-dark">{event.venue}</p>}
                      {event.city && (
                        <p className="text-sm text-brand-grey-dark">
                          {[event.city, event.state].filter(Boolean).join(', ')}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {event.registrationOpenDate && (
                  <div className="flex items-start gap-3">
                    <Calendar size={18} className="text-brand-blue mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-brand-blue-dark">Registration Opens</p>
                      <p className="text-sm text-brand-grey-dark">{formatDate(event.registrationOpenDate)}</p>
                    </div>
                  </div>
                )}

                {event.registrationCloseDate && (
                  <div className="flex items-start gap-3">
                    <Calendar size={18} className="text-brand-blue mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-brand-blue-dark">Registration Closes</p>
                      <p className="text-sm text-brand-grey-dark">{formatDate(event.registrationCloseDate)}</p>
                    </div>
                  </div>
                )}

                {event.capacity && (
                  <div className="flex items-start gap-3">
                    <Users size={18} className="text-brand-blue mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-brand-blue-dark">Capacity</p>
                      <p className="text-sm text-brand-grey-dark">Up to {event.capacity} participants</p>
                    </div>
                  </div>
                )}

                {event.eligibility && (
                  <div className="flex items-start gap-3">
                    <Users size={18} className="text-brand-blue mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-brand-blue-dark">Eligibility</p>
                      <p className="text-sm text-brand-grey-dark">{event.eligibility}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Side CTA */}
              <div className="bg-brand-blue-dark text-white rounded-xl p-6 text-center">
                <p className="font-bold text-lg mb-2">Ready to compete?</p>
                <p className="text-sm text-content-faint mb-4">
                  {status === 'open'
                    ? 'Registration is open. Secure your spot now.'
                    : status === 'coming-soon'
                    ? `Registration opens ${event.registrationOpenDate ? formatDate(event.registrationOpenDate) : 'soon'}.`
                    : 'Registration is now closed for this event.'}
                </p>
                {status !== 'closed' && (
                  <a
                    href={`/register/${slug}`}
                    className="btn-primary w-full justify-center text-sm"
                  >
                    {status === 'open' ? 'Register Now' : 'Get Notified'}
                  </a>
                )}
                <Link href="/events" className="block mt-3 text-xs text-content-faint hover:text-white transition-colors">
                  ← Back to all events
                </Link>
              </div>
            </aside>
          </div>
        </div>
      </section>

      {/* ── Registration CTA block ───────────────────────────────────── */}
      <section className="bg-brand-blue text-white section-padding">
        <div className="container-max text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to compete?</h2>
          <p className="text-blue-100 mb-8 max-w-xl mx-auto">
            Join students from across the country for one of the most challenging and rewarding STEM experiences of your school career.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <a
              href={`/register/${slug}/individual`}
              className="btn-outline-white text-base px-8 py-4"
            >
              Register as an Individual
            </a>
            <a
              href={`/register/${slug}/group`}
              className="bg-white text-brand-blue font-semibold text-base px-8 py-4 rounded-lg hover:bg-blue-50 transition-colors"
            >
              Register a Group
            </a>
          </div>
        </div>
      </section>
    </>
  )
}
