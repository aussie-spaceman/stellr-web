import type { Metadata } from 'next'
import Link from 'next/link'
import { Hero } from '@stellr/web-ui'
import { getAllEvents, getAllCampaigns, type StellarEvent } from '@/lib/sanity'
import { toCampaignCardData } from '@/lib/campaigns'
import { CampaignsBoard } from '@/components/campaigns/CampaignsBoard'
import { EventCard } from '@/components/ui/EventCard'
import { getMemberCampaignContext } from '@/lib/campaign-registrations'

export const metadata: Metadata = {
  title: 'Events & Campaigns',
  description:
    'Ticketed live Events and free, asynchronous Campaigns for middle and high school students.',
}

// Dynamic: the Campaigns board shows per-member "Registered" state via auth().
export const dynamic = 'force-dynamic'

export default async function EventsPage() {
  const [rawEvents, rawCampaigns, ctx] = await Promise.all([
    getAllEvents().catch(() => []) as Promise<StellarEvent[]>,
    getAllCampaigns().catch(() => []) as Promise<StellarEvent[]>,
    getMemberCampaignContext(),
  ])

  const campaigns = (rawCampaigns ?? []).map((c) => ({
    ...toCampaignCardData(c),
    registered: ctx.registeredSlugs.has(c.slug.current),
  }))
  const events = rawEvents ?? []

  return (
    <>
      <Hero
        title="Events & Campaigns"
        lead="Events are ticketed and happen on a set date. Campaigns are free with membership — asynchronous work your group completes at its own pace before a deadline."
      />

      <div className="mx-auto max-w-content px-8 py-14">
        {/* ── Campaigns ─────────────────────────────────────────────── */}
        <section aria-labelledby="campaigns-heading">
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <span
              id="campaigns-heading"
              className="inline-flex items-center rounded-pill bg-pathway-amber-bg px-3 py-1 text-ds-eyebrow font-bold uppercase text-pathway-amber"
            >
              ✦ Campaigns
            </span>
            <span className="text-ds-meta text-content-muted">
              Asynchronous · included with membership · Spring &amp; Fall
            </span>
          </div>

          {campaigns.length > 0 ? (
            <CampaignsBoard campaigns={campaigns} regContext="events" membership={ctx.membership} />
          ) : (
            <p className="rounded-ds-card border border-dashed border-line px-5 py-8 text-center text-sm text-content-muted">
              No open Campaigns right now. New Campaigns run each Spring and Fall.
            </p>
          )}
        </section>

        {/* ── Events ────────────────────────────────────────────────── */}
        <section aria-labelledby="events-heading" className="mt-14">
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <span
              id="events-heading"
              className="inline-flex items-center rounded-pill bg-primary-soft px-3 py-1 text-ds-eyebrow font-bold uppercase text-primary"
            >
              Events
            </span>
            <span className="text-ds-meta text-content-muted">Live · ticketed · one date</span>
          </div>

          <div className="grid gap-[18px] [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
            {events.map((event) => (
              <EventCard key={event._id} event={event} />
            ))}
            <Link
              href="/contact"
              className="flex min-h-[220px] flex-col items-center justify-center rounded-ds-card border border-dashed border-line px-5 py-8 text-center text-sm text-content-muted hover:border-primary hover:text-primary"
            >
              More live Events are added each term.
              <span className="mt-1 font-semibold">Host one at your school →</span>
            </Link>
          </div>
        </section>
      </div>
    </>
  )
}
