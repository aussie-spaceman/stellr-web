import { notFound } from 'next/navigation'
import { getEventBySlug } from '@/lib/sanity'
import { gradeBand } from '@/lib/grade-band'
import { formatDateRange } from '@/lib/utils'
import { getRegistrationPrefill } from '@/lib/registration-prefill'
import { supabaseServer } from '@/lib/supabase'
import { listEventAddons } from '@/lib/store/event-merch'
import IndividualRegistrationForm, { type ScholarshipFormOffer } from '@/components/forms/IndividualRegistrationForm'
import { findOfferByToken, discountedCents, formatUsd } from '@/lib/scholarships'
import { stripeClient } from '@/lib/stripe'
import { TrackEvent } from '@/components/analytics/TrackEvent'
import { participationTypeFor } from '@/lib/analytics'
import { MissionFundingNote } from '@/components/ui/MissionFundingNote'

interface PageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ scholarship?: string }>
}

// Email 2 of a scholarship offer lands here with ?scholarship=<token>. A token
// for a different event, or an offer no longer open, is ignored — the page is
// then the ordinary public form.
async function loadScholarshipOffer(
  token: string | undefined,
  slug: string,
  stripePriceId: string | undefined,
): Promise<ScholarshipFormOffer | null> {
  if (!token) return null
  const offer = await findOfferByToken(supabaseServer(), token).catch(() => null)
  if (!offer || offer.event_slug !== slug || offer.percent_off == null) return null
  let dueLabel: string | null = null
  const stripe = stripeClient()
  if (stripePriceId && stripe && offer.percent_off < 100) {
    const price = await stripe.prices.retrieve(stripePriceId).catch(() => null)
    if (price?.unit_amount != null) dueLabel = formatUsd(discountedCents(price.unit_amount, offer.percent_off))
  }
  return {
    token,
    percent: offer.percent_off,
    firstName: offer.first_name,
    lastName: offer.last_name,
    email: offer.email,
    dueLabel,
  }
}

export default async function IndividualRegistrationPage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const { scholarship: scholarshipToken } = await searchParams
  const event = await getEventBySlug(slug).catch(() => null)
  if (!event) notFound()
  const scholarship = await loadScholarshipOffer(scholarshipToken, slug, event.stripePriceId)

  const prefill = await getRegistrationPrefill().catch(() => null)
  const addons = await listEventAddons(supabaseServer(), slug).catch(() => [])
  // Grade options follow the event's eligible range, not a fixed 9–12.
  const band = gradeBand(event)

  return (
    <div className="min-h-screen bg-surface">
      {/* Funnel: user is filling the registration form (individual). No PII. */}
      <TrackEvent
        event={{
          event: 'registration_started',
          competition_name: event.title,
          competition_id: slug,
          participation_type: participationTypeFor(event.activityType),
        }}
      />
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
      <div className="bg-white border-b border-line">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center text-xs">✓</span>
            <span className="text-content-faint">Registration Type</span>
            <span className="text-content-faint mx-2">›</span>
            <span className="w-6 h-6 rounded-full bg-brand-blue text-white flex items-center justify-center text-xs font-bold">2</span>
            <span className="font-medium text-brand-blue-dark">Your Details</span>
            <span className="text-content-faint mx-2">›</span>
            <span className="w-6 h-6 rounded-full bg-line-light text-content-faint flex items-center justify-center text-xs font-bold">3</span>
            <span className="text-content-faint">Confirmation</span>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-10">
        <IndividualRegistrationForm
          eventSlug={slug}
          eventTitle={event.title}
          prefill={prefill}
          addons={addons}
          gradeMin={band.min}
          gradeMax={band.max}
          scholarship={scholarship}
        />
        <MissionFundingNote className="mt-10" />
      </div>
    </div>
  )
}
