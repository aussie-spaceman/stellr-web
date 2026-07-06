import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { Hero } from '@stellr/web-ui'
import { getAllEvents, getAllCampaigns, urlFor, wmSrc, type StellarEvent } from '@/lib/sanity'
import { toCampaignCardData, themeFromType, type CampaignCardData } from '@/lib/campaigns'
import { CampaignGridCard } from '@/components/campaigns/CampaignGridCard'
import { EventCard } from '@/components/ui/EventCard'
import { EventsFilterBar } from '@/components/sections/EventsFilterBar'
import { getMemberCampaignContext } from '@/lib/campaign-registrations'

export const metadata: Metadata = {
  title: 'Events & Campaigns',
  description:
    'Live, in-person design competitions and asynchronous Campaigns your school runs on its own schedule — for middle and high school students.',
}

// Dynamic: campaign cards show per-member "Registered" state via auth(), and
// the filter bar drives server-side filtering through searchParams.
export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ theme?: string; location?: string; grade?: string }>
}

// One sortable item per card so Events and Campaigns share a single grid,
// ordered by the date that matters: event day for Events, proposal deadline
// for Campaigns. Undated items sink to the end.
type GridItem =
  | { kind: 'event'; sortKey: string; event: StellarEvent }
  | { kind: 'campaign'; sortKey: string; campaign: CampaignCardData }

const NO_DATE = '9999-12-31'

export default async function EventsPage({ searchParams }: PageProps) {
  const { theme, location, grade } = await searchParams

  const [rawEvents, rawCampaigns, ctx] = await Promise.all([
    getAllEvents().catch(() => []) as Promise<StellarEvent[]>,
    getAllCampaigns().catch(() => []) as Promise<StellarEvent[]>,
    getMemberCampaignContext(),
  ])

  const events: GridItem[] = (rawEvents ?? [])
    .filter((e) => {
      if (location === 'campaign') return false
      if (theme && themeFromType(e.type) !== theme) return false
      if (grade && e.gradeLevel !== grade) return false
      return true
    })
    .map((e) => ({ kind: 'event', sortKey: e.date ?? NO_DATE, event: e }))

  const campaigns: GridItem[] = (rawCampaigns ?? [])
    .filter((c) => c.slug?.current)
    .filter((c) => {
      if (location === 'event') return false
      if (theme && themeFromType(c.type) !== theme) return false
      // Campaigns without a grade level are school-wide — keep them visible.
      if (grade && c.gradeLevel && c.gradeLevel !== grade) return false
      return true
    })
    .map((c) => ({
      kind: 'campaign',
      sortKey: c.deadline ?? NO_DATE,
      campaign: {
        ...toCampaignCardData(c),
        registered: ctx.registeredSlugs.has(c.slug.current),
        imageUrl: c.image ? wmSrc(urlFor(c.image).width(600).height(352).url()) : null,
      },
    }))

  const items = [...events, ...campaigns].sort((a, b) => a.sortKey.localeCompare(b.sortKey))

  return (
    <>
      <Hero
        title="Events & Campaigns"
        lead={
          <>
            Events = Live, In-Person Competitions
            <br />
            Campaigns = Async Competitions At Your School
            <br />
            Register Today!
          </>
        }
      />

      {/* Filter bar */}
      <section className="bg-surface border-b border-line px-4 sm:px-6 lg:px-8 py-4">
        <div className="mx-auto max-w-content">
          <Suspense fallback={null}>
            <EventsFilterBar />
          </Suspense>
        </div>
      </section>

      {/* Unified card grid — every Event and Campaign is its own card */}
      <section className="bg-white pt-10 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-content">
          {items.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {items.map((item) =>
                item.kind === 'event' ? (
                  <EventCard key={item.event._id} event={item.event} />
                ) : (
                  <CampaignGridCard
                    key={item.campaign.slug}
                    campaign={item.campaign}
                  />
                ),
              )}
              <Link
                href="/host-an-event"
                className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-line px-5 py-8 text-center text-sm text-content-muted hover:border-primary hover:text-primary"
              >
                More live Events are added each term.
                <span className="mt-1 font-semibold">Host one at your school →</span>
              </Link>
            </div>
          ) : (
            <div className="text-center py-16 text-brand-grey-mid">
              <p className="text-lg">No events or campaigns match your filters.</p>
              <Link
                href="/events"
                className="mt-4 inline-block text-brand-blue hover:underline text-sm"
              >
                Clear filters
              </Link>
            </div>
          )}
        </div>
      </section>
    </>
  )
}
