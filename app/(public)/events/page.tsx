import type { Metadata } from 'next'
import { Hero } from '@stellr/web-ui'
import { getAllEvents, getAllCampaigns, urlFor, wmSrc, type StellarEvent } from '@/lib/sanity'
import { toCampaignCardData, themeFromType, type CampaignCardData } from '@/lib/campaigns'
import { CampaignGridCard } from '@/components/campaigns/CampaignGridCard'
import { EventCard } from '@/components/ui/EventCard'
import { EventsBoard, type BoardItem } from '@/components/sections/EventsBoard'
import { matchesGradeFilter } from '@/lib/grade-band'

export const metadata: Metadata = {
  alternates: { canonical: '/events' },
  title: 'Events & Campaigns',
  description:
    'Live, in-person design competitions and asynchronous Campaigns your school runs on its own schedule — for middle and high school students.',
}

// Static, refreshed hourly (the Sanity reads carry the same window). The filter
// chips work in the browser (EventsBoard), and a signed-in member's
// "Registered" badges fill in there too (CampaignCardAction), so nothing here
// reads the request and the page is served from the CDN.
export const revalidate = 3600

// One sortable item per card so Events and Campaigns share a single grid,
// ordered by the date that matters: event day for Events, proposal deadline
// for Campaigns. Undated items sink to the end.
type GridItem =
  | { kind: 'event'; sortKey: string; event: StellarEvent; filter: BoardItem }
  | { kind: 'campaign'; sortKey: string; campaign: CampaignCardData; filter: BoardItem }

const NO_DATE = '9999-12-31'

export default async function EventsPage() {
  const [rawEvents, rawCampaigns] = await Promise.all([
    getAllEvents().catch(() => []) as Promise<StellarEvent[]>,
    getAllCampaigns().catch(() => []) as Promise<StellarEvent[]>,
  ])

  const events: GridItem[] = (rawEvents ?? []).map((e) => ({
    kind: 'event',
    sortKey: e.date ?? NO_DATE,
    event: e,
    filter: {
      kind: 'event',
      theme: themeFromType(e.type),
      middle: matchesGradeFilter(e, 'Middle School'),
      high: matchesGradeFilter(e, 'High School'),
    },
  }))

  const campaigns: GridItem[] = (rawCampaigns ?? [])
    .filter((c) => c.slug?.current)
    .map((c) => ({
      kind: 'campaign',
      sortKey: c.deadline ?? NO_DATE,
      campaign: {
        ...toCampaignCardData(c),
        registered: false,
        imageUrl: c.image ? wmSrc(urlFor(c.image).width(600).height(352).url()) : null,
      },
      filter: {
        kind: 'campaign',
        theme: themeFromType(c.type),
        // Campaigns without a grade level are school-wide — they match both.
        middle: !c.gradeLevel || matchesGradeFilter(c, 'Middle School'),
        high: !c.gradeLevel || matchesGradeFilter(c, 'High School'),
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

      {/* Filter bar + unified card grid — every Event and Campaign is its own card */}
      <EventsBoard items={items.map((i) => i.filter)}>
        {items.map((item) =>
          item.kind === 'event' ? (
            <EventCard key={item.event._id} event={item.event} />
          ) : (
            <CampaignGridCard key={item.campaign.slug} campaign={item.campaign} />
          ),
        )}
      </EventsBoard>
    </>
  )
}
