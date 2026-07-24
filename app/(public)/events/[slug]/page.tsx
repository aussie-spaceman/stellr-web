import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MapPin, Calendar, Users } from 'lucide-react'
import { getEventBySlug, urlFor, wmSrc, type StellarEvent } from '@/lib/sanity'
import { formatDateRange, formatDate, registrationStatus } from '@/lib/utils'
import { PortableText } from 'next-sanity'
import type { PortableTextBlock } from '@portabletext/types'
import { CampaignDetail } from '@/components/campaigns/CampaignDetail'
import { EventHeroCtas, EventNotifyButton } from '@/components/sections/EventCtas'
import { getMemberCampaignContext } from '@/lib/campaign-registrations'
import { CardPills } from '@/components/ui/CardPills'
import { TrackEvent } from '@/components/analytics/TrackEvent'
import { participationTypeFor } from '@/lib/analytics'
import { buildEventJsonLd, buildCampaignJsonLd } from '@/lib/structured-data'

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
  const isCampaign = event.activityType === 'campaign'
  const kind = isCampaign
    ? 'Online STEM Campaign'
    : event.setting === 'virtual'
    ? 'Virtual STEM Competition'
    : 'In-Person STEM Competition'
  const audience = event.gradeLevel === 'Middle School' ? 'Middle School' : 'High School'
  const description =
    event.tagline ??
    `A Stellr ${event.type ?? 'design competition'} — a ${kind.toLowerCase()} for ${audience.toLowerCase()} students.`
  return {
    title: `${event.title} — ${kind}`,
    description,
    alternates: { canonical: `/events/${slug}` },
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

  // Campaigns render a dedicated, membership-aware detail view (no ticketing).
  if (event.activityType === 'campaign') {
    const ctx = await getMemberCampaignContext()
    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(buildCampaignJsonLd(event, slug)) }}
        />
        <TrackEvent
          event={{
            event: 'competition_page_view',
            competition_name: event.title,
            competition_id: slug,
            participation_type: 'campaign',
          }}
        />
        <CampaignDetail
          campaign={event}
          membership={ctx.membership}
          registered={ctx.registeredSlugs.has(slug)}
        />
      </>
    )
  }

  const status = registrationStatus(event.registrationOpenDate, event.registrationCloseDate)
  const { label: statusLabel, className: statusClass } = statusConfig[status]

  // JSON-LD for this event (Offline/Online Event + superEvent + offer).
  const jsonLd = buildEventJsonLd(event, slug)

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <TrackEvent
        event={{
          event: 'competition_page_view',
          competition_name: event.title,
          competition_id: slug,
          participation_type: participationTypeFor(event.activityType),
        }}
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
          {/* Standardised three-pill row (Event · Grade · Theme) + status */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <CardPills kind="event" gradeLevel={event.gradeLevel} type={event.type} size="md" />
            <span className={`text-sm font-semibold px-3 py-1.5 rounded-full border ${statusClass}`}>
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

          {/* Hero CTAs — Individual + Group registration; when registration
              isn't open both buttons open the subscriber modal instead. */}
          <EventHeroCtas
            slug={slug}
            title={event.title}
            status={status}
            opensLabel={event.registrationOpenDate ? formatDate(event.registrationOpenDate) : null}
          />
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
                {status === 'open' && (
                  <a
                    href={`/register/${slug}`}
                    className="btn-primary w-full justify-center text-sm"
                  >
                    Register Now
                  </a>
                )}
                {status === 'coming-soon' && (
                  <EventNotifyButton slug={slug} title={event.title} status={status} />
                )}
                <Link href="/events" className="block mt-3 text-xs text-content-faint hover:text-white transition-colors">
                  ← Back to all events
                </Link>
              </div>
            </aside>
          </div>
        </div>
      </section>

    </>
  )
}
