import 'server-only'

import { getEventsForSchema } from '@/lib/sanity'
import { getEventPrice } from '@/lib/event-pricing'
import type { SeriesMember } from '@/lib/structured-data'

/**
 * The events that make up the competition series, with each fee resolved from
 * Stripe, ready for `competitionSeries()` / `buildCompetitionSeriesJsonLd()`.
 *
 * `EventSeries` is a subtype of Event, so Google validates a series node
 * against the Event spec — it needs dates, a place and a fee. Those are derived
 * from the real events rather than authored a second time, which is why every
 * page that publishes a series node loads this first.
 *
 * Prices are cached per Stripe price ID (see lib/event-pricing.ts), so a dozen
 * events cost a dozen cached reads at most once per ISR window. Sanity being
 * unconfigured, or either lookup failing, degrades to an empty list: the series
 * node then describes itself without dates rather than the page failing.
 */
export async function getSeriesMembers(): Promise<SeriesMember[]> {
  const events = await getEventsForSchema().catch(() => null)
  if (!events || events.length === 0) return []
  return Promise.all(
    events.map(async (event) => ({ event, price: await getEventPrice(event.stripePriceId) })),
  )
}
