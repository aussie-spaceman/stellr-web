import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MapPin, Calendar, Users, Ticket, Check } from 'lucide-react'
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
import { buildEventJsonLd, buildCampaignJsonLd, buildFaqJsonLd } from '@/lib/structured-data'
import { getEventPrice, eventPriceLabel } from '@/lib/event-pricing'
import { MissionFundingNote } from '@/components/ui/MissionFundingNote'

export const revalidate = 3600

interface EventData extends StellarEvent {
  description?: PortableTextBlock[]
  capacity?: number
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

// The competition season these pages describe. The prize trip and the t-shirt
// are named by year in the copy below — bump this one constant each season
// rather than hunting the strings.
const SEASON_YEAR = 2027

// Every live event includes the same package. Kept here (not in Sanity) so the
// promise is identical on all ten event pages and can't drift per-event.
const INCLUDED: string[] = [
  'Annual Stellr Membership for students and teachers',
  `${SEASON_YEAR} limited edition Stellr Community t-shirt`,
  'All event materials and facility access',
  'Meals and snacks',
  `Opportunity to progress to the ${SEASON_YEAR} International Student Engineering Congress, held at NASA Johnson Space Center (Houston, TX) in summer ${SEASON_YEAR}`,
]

// The event-day arc, same at every venue.
const HOW_IT_WORKS: string[] = [
  'Student participants arrive and are formed into their ‘engineering companies’.',
  'Each company is briefed on the event engineering challenge and receives a Request For Proposal (RFP) setting out the requirements they need to respond to.',
  'Participants are then guided through their designs, working under time, communication, and information pressures.',
  'Each engineering company presents its design before a panel of judges.',
  `Awards are presented — to the winning company, and to exceptional individuals, who receive an invitation to our culminating event in the summer of ${SEASON_YEAR}.`,
]

/**
 * Standard eligibility wording, shown on every event. The audience clause is
 * derived from the event's grade level so a middle school event never inherits
 * the high school grade range — everything after it is constant.
 *
 * This deliberately ignores the per-event Sanity `eligibility` note, which is
 * retired: hand-authored copy had already drifted from the current rules (one
 * event still promised "Teams of 4–6 students").
 */
function eligibilityCopy(gradeLevel?: string): string {
  const audience =
    gradeLevel === 'Middle School'
      ? 'middle school students (grades 6–8)'
      : gradeLevel === 'Both'
        ? 'middle and high school students (grades 6–12)'
        : 'high school students (grades 9–12)'
  return (
    `Open to all ${audience}. Students can register individually, or register as part of a ` +
    'group (from 2–12 students). Schools can register multiple teams.'
  )
}

// `a` renders on the page; `text` is the plain-text equivalent serialised into
// the FAQPage JSON-LD (schema.org answers can't carry React nodes). Keep the
// two in step — FAQ markup that doesn't match the visible copy is treated as
// spam by search and answer engines.
const FAQS: { q: string; a: React.ReactNode; text: string }[] = [
  {
    q: 'What should my team bring on the day?',
    a: 'All competition material is provided, along with snacks and meals. Bring pens, notebooks, and general school work material. We recommend bringing a laptop or tablet if you have access to one — you will not be disadvantaged if you don’t.',
    text: 'All competition material is provided, along with snacks and meals. Bring pens, notebooks, and general school work material. We recommend bringing a laptop or tablet if you have access to one — you will not be disadvantaged if you don’t.',
  },
  {
    q: 'How are teams structured?',
    a: 'Both individual students and groups (from 2–12 students) can register. Student participants are formed into ‘engineering companies’ when they arrive at the event.',
    text: 'Both individual students and groups (from 2–12 students) can register. Student participants are formed into ‘engineering companies’ when they arrive at the event.',
  },
  {
    q: 'What if I can’t afford to attend?',
    a: (
      <>
        If you wish to attend but can’t afford the fees, please look at our{' '}
        <Link href="/scholarship" className="text-primary-deep font-medium hover:underline">
          scholarship page
        </Link>
        .
      </>
    ),
    text: 'If you wish to attend but can’t afford the fees, please look at our scholarship page at https://www.stellreducation.org/scholarship.',
  },
  {
    q: 'This seems like a really challenging activity! What are the preparation expectations?',
    a: 'Nothing! No, really, nothing! All our challenges are designed for students to arrive and compete with no preparation activities or prior work. Important note: some of our events offer optional pre-work activities for teachers. These are NOT mandatory, and don’t impart any benefit on students who may participate in the pre-work.',
    text: 'Nothing! No, really, nothing! All our challenges are designed for students to arrive and compete with no preparation activities or prior work. Important note: some of our events offer optional pre-work activities for teachers. These are NOT mandatory, and don’t impart any benefit on students who may participate in the pre-work.',
  },
  {
    q: 'What are the expectations for teachers and chaperones?',
    a: 'You don’t need to be a specialist engineer or scientist to support students attending our events! If you’re bringing a team, we ask that you stay at the event venue for the duration, and you can participate if you wish. Otherwise you’re free to catch up on marking, do more lesson planning, or sit quietly in a corner!',
    text: 'You don’t need to be a specialist engineer or scientist to support students attending our events! If you’re bringing a team, we ask that you stay at the event venue for the duration, and you can participate if you wish. Otherwise you’re free to catch up on marking, do more lesson planning, or sit quietly in a corner!',
  },
  {
    q: 'How does transportation and event logistics work?',
    a: (
      <>
        All participants are responsible for making their own way to and from the event venue. We fully
        understand the tyranny of distance — regardless of whether you’re a regional school or having to
        travel across a metro area! If you need to arrive late, or depart early, please{' '}
        <Link href="/contact" className="text-primary-deep font-medium hover:underline">
          get in touch
        </Link>{' '}
        and we’ll make it work.
      </>
    ),
    text: 'All participants are responsible for making their own way to and from the event venue. We fully understand the tyranny of distance — regardless of whether you’re a regional school or having to travel across a metro area! If you need to arrive late, or depart early, please get in touch at https://www.stellreducation.org/contact and we’ll make it work.',
  },
  {
    q: 'How does registration and invoicing work?',
    a: (
      <>
        Register using the Individual or Group buttons above. As you progress through the registration
        process, there are options for immediate online payment, to be issued a single invoice, or for
        group members to pay themselves. Any issues,{' '}
        <Link href="/contact" className="text-primary-deep font-medium hover:underline">
          let us know
        </Link>
        !
      </>
    ),
    text: 'Register using the Individual or Group buttons above. As you progress through the registration process, there are options for immediate online payment, to be issued a single invoice, or for group members to pay themselves. Any issues, let us know at https://www.stellreducation.org/contact.',
  },
  {
    q: 'What happens if I can’t attend after registering?',
    a: (
      <>
        Please notify us as soon as possible. Review our{' '}
        <Link href="/terms#refunds" className="text-primary-deep font-medium hover:underline">
          Terms of Service
        </Link>{' '}
        for specifics.
      </>
    ),
    text: 'Please notify us as soon as possible. Review our Terms of Service at https://www.stellreducation.org/terms#refunds for specifics.',
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

  // Per-participant fee, resolved live from Stripe. `priceLabel` is null when
  // the event's price ID can't be resolved (missing or inactive in Stripe) —
  // every price surface below then renders nothing rather than guessing.
  const price = await getEventPrice(event.stripePriceId)
  const priceLabel = eventPriceLabel(price)

  // JSON-LD for this event (Offline/Online Event + superEvent + offer) plus the
  // FAQ accordion rendered further down the page. The offer carries the same
  // fee shown on the page — schema that contradicts the visible price is
  // treated as spam.
  const jsonLd = [buildEventJsonLd(event, slug, price), buildFaqJsonLd(FAQS)]

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
            <p className="text-blue-300 text-lg mb-1">
              📍 {[event.venue, event.city && event.state ? `${event.city}, ${event.state}` : event.city].filter(Boolean).join(' · ')}
            </p>
          )}

          {priceLabel && <p className="text-blue-300 text-lg">🎟️ {priceLabel}</p>}

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

              {/* What's Included — identical package at every event */}
              <div>
                <h2 className="text-2xl font-bold text-brand-blue-dark mb-4">What’s Included</h2>
                <ul className="space-y-3">
                  {INCLUDED.map((item) => (
                    <li key={item} className="flex items-start gap-3">
                      <Check size={18} className="text-brand-blue mt-1 shrink-0" />
                      <span className="text-brand-grey-dark">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* How the Challenge Works — the event-day arc */}
              <div>
                <h2 className="text-2xl font-bold text-brand-blue-dark mb-4">How the Challenge Works</h2>
                <ol className="space-y-4">
                  {HOW_IT_WORKS.map((step, i) => (
                    <li key={step} className="flex items-start gap-4">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-blue text-sm font-bold text-white">
                        {i + 1}
                      </span>
                      <span className="text-brand-grey-dark pt-1">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

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

                {priceLabel && (
                  <div className="flex items-start gap-3">
                    <Ticket size={18} className="text-brand-blue mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-brand-blue-dark">Price</p>
                      <p className="text-sm text-brand-grey-dark">{priceLabel}</p>
                      {/* Only meaningful where there's a fee to discount. */}
                      {price.kind === 'priced' && (
                        <p className="mt-1 text-sm text-brand-grey-dark">
                          Large group discounts available —{' '}
                          <Link href="/contact" className="text-primary-deep font-medium hover:underline">
                            Contact Stellr
                          </Link>
                          .
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

                <div className="flex items-start gap-3">
                  <Users size={18} className="text-brand-blue mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-brand-blue-dark">Eligibility</p>
                    <p className="text-sm text-brand-grey-dark">{eligibilityCopy(event.gradeLevel)}</p>
                  </div>
                </div>
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

      <section className="section-padding bg-surface">
        <div className="container-max max-w-3xl">
          <MissionFundingNote />
        </div>
      </section>

    </>
  )
}
