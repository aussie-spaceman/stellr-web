import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MapPin, Calendar, Users, ExternalLink } from 'lucide-react'
import { getEventBySlug, urlFor } from '@/lib/sanity'
import { formatDateRange, formatDate, registrationStatus } from '@/lib/utils'
import { PortableText } from 'next-sanity'
import type { PortableTextBlock } from '@portabletext/types'

export const revalidate = 3600

interface EventData {
  _id: string
  title: string
  slug: { current: string }
  type?: string
  gradeLevel?: string
  date?: string
  endDate?: string
  venue?: string
  city?: string
  state?: string
  tagline?: string
  image?: { asset: { _ref: string } }
  description?: PortableTextBlock[]
  registrationOpen?: boolean
  registrationOpenDate?: string
  registrationCloseDate?: string
  capacity?: number
  eligibility?: string
}

interface PageProps {
  params: { slug: string }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const event: EventData | null = await getEventBySlug(params.slug).catch(() => null)
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

const PLACEHOLDER_FAQS = [
  { q: 'What should my team bring on the day?', a: 'All materials for the design challenge are provided. Bring pens, notebooks, and any reference materials allowed in the event brief (sent 2 weeks before the event).' },
  { q: 'How many students can be on a team?', a: 'Teams are typically 4–6 students. Individual entries may be accommodated — contact us for details.' },
  { q: 'Is there a cost to participate?', a: 'Registration costs vary by event. Pathfinder members receive priority registration. Full pricing is shown during the registration process.' },
  { q: 'What happens if we can\'t attend after registering?', a: 'Please notify us as soon as possible. Cancellations made more than 14 days before the event may be eligible for a refund or credit.' },
]

export default async function EventDetailPage({ params }: PageProps) {
  const event: EventData | null = await getEventBySlug(params.slug).catch(() => null)
  if (!event) notFound()

  const authUrl = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'
  const status = registrationStatus(event.registrationOpen ?? false, event.registrationOpenDate, event.registrationCloseDate)
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
    url: `https://www.stellreducation.org/events/${params.slug}`,
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative bg-brand-navy text-white">
        {event.image ? (
          <div className="relative h-72 sm:h-96">
            <Image
              src={urlFor(event.image).width(1400).height(600).url()}
              alt={event.title}
              fill
              className="object-cover opacity-40"
              priority
            />
          </div>
        ) : (
          <div className="h-48 bg-gradient-to-br from-brand-navy to-blue-900" />
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
              <span className="text-xs font-semibold px-3 py-1 rounded-full bg-white/10 text-gray-300">
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
              href={`${authUrl}/register/${params.slug}`}
              className="btn-primary text-base px-8 py-4"
            >
              Register Now
            </a>
            <a
              href="#"
              className="btn-outline-white text-base px-8 py-4 flex items-center gap-2"
            >
              <ExternalLink size={16} /> Download Info Pack
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

              {/* Schedule placeholder */}
              <div>
                <h2 className="text-2xl font-bold text-brand-navy mb-4">Schedule</h2>
                <div className="space-y-3">
                  {[
                    { time: 'Day 1 — 08:30', label: 'Registration & welcome' },
                    { time: 'Day 1 — 09:00', label: 'Challenge brief released — teams begin design work' },
                    { time: 'Day 1 — 12:00', label: 'Lunch (provided)' },
                    { time: 'Day 1 — 17:00', label: 'End of day 1' },
                    { time: 'Day 2 — 08:30', label: 'Design work resumes' },
                    { time: 'Day 2 — 13:00', label: 'Presentations to judges' },
                    { time: 'Day 2 — 16:00', label: 'Awards ceremony & close' },
                  ].map((item) => (
                    <div key={item.time} className="flex gap-4 text-sm">
                      <span className="font-mono text-brand-grey-mid w-40 shrink-0">{item.time}</span>
                      <span className="text-brand-grey-dark">{item.label}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-brand-grey-mid italic">Schedule is indicative — full timetable released 2 weeks before event.</p>
              </div>

              {/* FAQ accordion */}
              <div>
                <h2 className="text-2xl font-bold text-brand-navy mb-4">Frequently Asked Questions</h2>
                <div className="space-y-3">
                  {PLACEHOLDER_FAQS.map((faq) => (
                    <details key={faq.q} className="group border border-gray-200 rounded-lg">
                      <summary className="flex items-center justify-between p-4 cursor-pointer font-medium text-brand-navy list-none">
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
                <h2 className="text-lg font-bold text-brand-navy">Event Details</h2>

                {event.date && (
                  <div className="flex items-start gap-3">
                    <Calendar size={18} className="text-brand-blue mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-brand-navy">Date</p>
                      <p className="text-sm text-brand-grey-dark">{formatDateRange(event.date, event.endDate)}</p>
                    </div>
                  </div>
                )}

                {(event.venue || event.city) && (
                  <div className="flex items-start gap-3">
                    <MapPin size={18} className="text-brand-blue mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-brand-navy">Venue</p>
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
                      <p className="text-sm font-semibold text-brand-navy">Registration Opens</p>
                      <p className="text-sm text-brand-grey-dark">{formatDate(event.registrationOpenDate)}</p>
                    </div>
                  </div>
                )}

                {event.registrationCloseDate && (
                  <div className="flex items-start gap-3">
                    <Calendar size={18} className="text-brand-blue mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-brand-navy">Registration Closes</p>
                      <p className="text-sm text-brand-grey-dark">{formatDate(event.registrationCloseDate)}</p>
                    </div>
                  </div>
                )}

                {event.capacity && (
                  <div className="flex items-start gap-3">
                    <Users size={18} className="text-brand-blue mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-brand-navy">Capacity</p>
                      <p className="text-sm text-brand-grey-dark">Up to {event.capacity} participants</p>
                    </div>
                  </div>
                )}

                {event.eligibility && (
                  <div className="flex items-start gap-3">
                    <Users size={18} className="text-brand-blue mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-brand-navy">Eligibility</p>
                      <p className="text-sm text-brand-grey-dark">{event.eligibility}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Side CTA */}
              <div className="bg-brand-navy text-white rounded-xl p-6 text-center">
                <p className="font-bold text-lg mb-2">Ready to compete?</p>
                <p className="text-sm text-gray-300 mb-4">
                  {status === 'open'
                    ? 'Registration is open. Secure your spot now.'
                    : status === 'coming-soon'
                    ? `Registration opens ${event.registrationOpenDate ? formatDate(event.registrationOpenDate) : 'soon'}.`
                    : 'Registration is now closed for this event.'}
                </p>
                {status !== 'closed' && (
                  <a
                    href={`${authUrl}/register/${params.slug}`}
                    className="btn-primary w-full justify-center text-sm"
                  >
                    {status === 'open' ? 'Register Now' : 'Get Notified'}
                  </a>
                )}
                <Link href="/events" className="block mt-3 text-xs text-gray-400 hover:text-white transition-colors">
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
              href={`${authUrl}/register/${params.slug}?type=individual`}
              className="btn-outline-white text-base px-8 py-4"
            >
              Register as an Individual
            </a>
            <a
              href={`${authUrl}/register/${params.slug}?type=group`}
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
