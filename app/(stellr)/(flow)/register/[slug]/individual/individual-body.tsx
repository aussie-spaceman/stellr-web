import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { getEventBySlug } from '@/lib/events/repo'
import { gradeBand } from '@/lib/grade-band'
import { formatDateRange } from '@/lib/utils'
import type { RegistrationPrefill } from '@/lib/registration-prefill'
import { supabaseServer } from '@/lib/supabase'
import { listEventAddons } from '@/lib/store/event-merch'
import IndividualRegistrationForm, { type ScholarshipFormOffer } from '@/components/forms/IndividualRegistrationForm'
import { findOfferByToken, discountedCents, formatUsd } from '@/lib/scholarships'
import { stripeClient } from '@/lib/stripe'
import type { StellrRegistrationNotes } from '../stellr-notes'
import { getEventPrice } from '@/lib/event-pricing'
import { StepBar } from '@/components/registration/StepBar'

// The individual registration page, shared by Stellr's page and the tenant tree's.
// It holds no tracking: test/tenant-tree-no-analytics.test.ts walks this file's
// imports. Stellr's page supplies its funnel event through `funnel`.
//
// The same goes for the prefill, through `loadPrefill`. It reads the member's latest
// roster row, from any organiser, so a tenant's form must not get it.
//
// A plain function rather than a component, called by the page's own return, so
// Stellr's page returns the same tree as before: test/flow-pages-golden.test.tsx.

type RegistrationEvent = NonNullable<Awaited<ReturnType<typeof getEventBySlug>>>

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

export async function individualRegistrationBody({
  slug,
  scholarshipToken,
  funnel,
  loadPrefill,
  stellrNotes,
}: {
  slug: string
  scholarshipToken: string | undefined
  funnel?: (event: RegistrationEvent) => ReactNode
  loadPrefill?: () => Promise<RegistrationPrefill | null>
  /** S5 A7: Stellr's guarantee and mission note. Only Stellr's page supplies them. */
  stellrNotes?: StellrRegistrationNotes
}) {
  const event = await getEventBySlug(slug).catch(() => null)
  if (!event) notFound()
  const scholarship = await loadScholarshipOffer(scholarshipToken, slug, event.stripePriceId)

  const prefill = loadPrefill ? await loadPrefill() : null
  const addons = await listEventAddons(supabaseServer(), slug).catch(() => [])
  // Grade options follow the event's eligible range, not a fixed 9–12.
  const band = gradeBand(event)
  const price = await getEventPrice(event.stripePriceId)

  return (
    <div className="bg-surface">
      {funnel?.(event)}
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
          <StepBar steps={['Registration Type', 'Your Details', 'Confirmation']} current={2} />
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
        {price.kind === 'priced' && stellrNotes?.guarantee}
        {stellrNotes?.missionFunding}
      </div>
    </div>
  )
}
