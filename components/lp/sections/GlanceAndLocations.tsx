import { LocationLegend, LocationMap } from '@/components/lp/LocationMap'
import { GLANCE_EYEBROW, GLANCE_FACTS } from '@/content/lp/shared'
import type { LocationCounts, MapLocation } from '@/lib/locations'

/**
 * "At a glance" facts beside the location map.
 *
 * This replaced an earlier When / Where / Cost fact strip, because the pages
 * are event-agnostic: a strip that names a date and a venue contradicts the
 * whole premise. Hence "Cost varies by event" rather than a number — the price
 * lives on the event page, where a Stripe price object is the source of truth.
 */
export function GlanceAndLocations({
  locations, counts, mapLead,
}: {
  locations: readonly MapLocation[]
  counts: LocationCounts
  /** Already interpolated with the derived counts. */
  mapLead: string
}) {
  return (
    <section aria-labelledby="where-h" id="where" className="bg-surface px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-content">
        <div className="grid overflow-hidden rounded-panel border border-line bg-white shadow-card-lift lg:grid-cols-[0.42fr_1fr]">
          <div className="grid content-start gap-5 px-7 py-7">
            <p className="font-display text-ds-eyebrow font-bold uppercase text-content-faint">
              {GLANCE_EYEBROW}
            </p>
            {GLANCE_FACTS.map((fact) => (
              <div key={fact.value}>
                {/* Value first: the fact is the headline, the gloss is support. */}
                <p className="font-display text-lg font-bold leading-tight tracking-heading text-ink">
                  {fact.value}
                </p>
                {/* The third fact's label carries a newline and means it. */}
                <p className="mt-1 whitespace-pre-line text-ds-meta leading-relaxed text-content-muted">
                  {fact.label}
                </p>
              </div>
            ))}
          </div>

          <div className="border-t border-line-light px-7 py-7 lg:border-l lg:border-t-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
              <h2 id="where-h" className="font-display text-3xl font-bold tracking-heading text-ink">
                Where we run
              </h2>
              <LocationLegend counts={counts} />
            </div>
            <p className="mt-3 max-w-[40em] leading-relaxed text-content-secondary">{mapLead}</p>
            <div className="mt-5">
              <LocationMap locations={locations} counts={counts} headingId="where-h" />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
