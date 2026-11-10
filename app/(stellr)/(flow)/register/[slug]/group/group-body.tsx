import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { getEventBySlug } from '@/lib/events/repo'
import { gradeBand } from '@/lib/grade-band'
import { formatDateRange } from '@/lib/utils'
import type { RegistrationPrefill } from '@/lib/registration-prefill'
import { getEventPrice } from '@/lib/event-pricing'
import GroupRegistrationForm from '@/components/forms/GroupRegistrationForm'
import type { StellrRegistrationNotes } from '../stellr-notes'

// The group registration page, shared by Stellr's page and the tenant tree's. It
// holds no tracking and no prefill of its own, and is a plain function called by the
// page's own return: see individual-body.tsx.

type RegistrationEvent = NonNullable<Awaited<ReturnType<typeof getEventBySlug>>>

export async function groupRegistrationBody({
  slug,
  funnel,
  loadPrefill,
  stellrNotes,
}: {
  slug: string
  funnel?: (event: RegistrationEvent) => ReactNode
  loadPrefill?: () => Promise<RegistrationPrefill | null>
  /** S5 A7: Stellr's guarantee and mission note. Only Stellr's page supplies them. */
  stellrNotes?: StellrRegistrationNotes
}) {
  const event = await getEventBySlug(slug).catch(() => null)
  if (!event) notFound()

  const prefill = loadPrefill ? await loadPrefill() : null
  // Grade options follow the event's eligible range, not a fixed 9–12.
  const band = gradeBand(event)
  const isCampaign = event.activityType === 'campaign'
  // Nothing to charge = the form skips the "how will the group pay?" question
  // entirely rather than offering three methods that all collect nothing. That
  // covers both an event with no price configured and one carrying an explicit
  // $0 price (how free events are set up). A price that exists but failed to
  // resolve is NOT free — the form keeps asking, and the API rejects the
  // registration with an actionable error rather than silently waiving a fee.
  const price = await getEventPrice(event.stripePriceId)
  const isFree = price.kind === 'free' || price.kind === 'tbc'

  return (
    <div className="bg-surface">
      {funnel?.(event)}
      <div className="bg-brand-blue-dark text-white py-10 px-4">
        <div className="max-w-3xl mx-auto">
          <p className="text-blue-300 text-sm mb-4">← {isCampaign ? 'Campaign Registration' : 'Group Registration'}</p>
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">{event.title}</h1>
          {event.date && (
            <p className="text-blue-300 text-sm">
              📅 {formatDateRange(event.date, event.endDate)}
              {event.city && ` · 📍 ${event.city}${event.state ? `, ${event.state}` : ''}`}
            </p>
          )}
        </div>
      </div>

      {/* Step bar is rendered inside GroupRegistrationForm so it can reflect the current step */}

      <div className="max-w-3xl mx-auto px-4 py-10">
        <GroupRegistrationForm
          eventSlug={slug}
          eventTitle={event.title}
          prefill={prefill}
          isCampaign={isCampaign}
          isFree={isFree}
          gradeMin={band.min}
          gradeMax={band.max}
        />
        {!isCampaign && !isFree && stellrNotes?.guarantee}
        {stellrNotes?.missionFunding}
      </div>
    </div>
  )
}
