import { MissionFundingNote } from '@/components/ui/MissionFundingNote'
import { TrackEvent } from '@/components/analytics/TrackEvent'
import { countLocations, fillCounts, getMapLocations } from '@/lib/locations'
import { MAP_LEAD } from '@/content/lp/shared'
import { LpHero } from '@/components/lp/sections/LpHero'
import { GlanceAndLocations } from '@/components/lp/sections/GlanceAndLocations'
import { Reasons } from '@/components/lp/sections/Reasons'
import { Gallery } from '@/components/lp/sections/Gallery'
import { Testimonials } from '@/components/lp/sections/Testimonials'
import { ReserveBlock } from '@/components/lp/sections/ReserveBlock'
import { Faq } from '@/components/lp/sections/Faq'
import type { LandingPageConfig } from '@/content/lp/types'

/**
 * The single landing page layout. Every audience page is this component with a
 * different config — adding one is a config file and a registry line, never
 * layout work.
 *
 * Two things are resolved here rather than in the sections, because they must
 * be identical everywhere on the page:
 *
 *   • **The location counts.** One query, one set of numbers, interpolated into
 *     the hero eyebrow, the map lead and the FAQ answer. The handoff had four
 *     separate hand-typed versions of these figures and they already disagreed
 *     with each other and with the dataset.
 *   • **The booking URL.** An env var, because it is a calendar link on someone
 *     else's product and will change without a deploy being welcome.
 */
const BOOKING_URL =
  process.env.NEXT_PUBLIC_BOOKING_URL ?? 'https://app.usemotion.com/meet/david-m-shaw/welcome'

export async function LandingPage({ config }: { config: LandingPageConfig }) {
  const locations = await getMapLocations()
  const counts = countLocations(locations)
  const fill = (text: string) => fillCounts(text, counts)

  // Interpolate the copy the counts appear in, leaving the configs free of
  // typed numbers that would go stale the next time a venue is added.
  const resolved: LandingPageConfig = {
    ...config,
    hero: { ...config.hero, eyebrow: fill(config.hero.eyebrow) },
    faq: {
      ...config.faq,
      items: config.faq.items.map((item) => ({ ...item, a: fill(item.a) })),
    },
  }

  return (
    <>
      <TrackEvent
        event={{ event: 'lp_view', lp_audience: config.audience, page_slug: config.slug }}
      />

      <LpHero config={resolved} eyebrow={resolved.hero.eyebrow} />
      <GlanceAndLocations locations={locations} counts={counts} mapLead={fill(MAP_LEAD)} />
      <Reasons config={resolved} />
      <Gallery config={resolved} />
      <Testimonials config={resolved} />
      <ReserveBlock config={resolved} bookingUrl={BOOKING_URL} />
      <Faq config={resolved} />

      {/* Google Ad Grants requires a nonprofit to say where the money goes at
          the point of price, on every surface it pays to send traffic to. Its
          absence from the paid surfaces was one of the three grounds the
          rebranded domain was rejected on — these pages are ad destinations, so
          it belongs here even though nothing on the page asks for payment. */}
      <section aria-label="How Stellr is funded" className="bg-white px-4 pb-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-content">
          <MissionFundingNote variant="general" />
        </div>
      </section>
    </>
  )
}
