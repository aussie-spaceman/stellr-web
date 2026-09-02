import { US_STATE_PATHS, US_VIEWBOX, project } from '@/lib/us-outline'
import { hasPin, type LocationCounts, type MapLocation } from '@/lib/locations'

/**
 * "Where we run" — the derived location map.
 *
 * This replaces a 3260x2093 raster with eleven hard-coded pin labels. That
 * raster went stale the moment a venue changed, and its labels were unreadable
 * on a phone. Here the pins, the legend counts and the accessible list all come
 * from the same query (lib/locations.ts), so they cannot disagree.
 *
 * Three things carry the information, not decoration:
 *   • Pin colour is the competition theme, matching the page's own accent.
 *   • Pin fill vs. ring separates a running event from a planned one, so status
 *     survives being printed in greyscale or seen by a colour-blind reader.
 *   • Below `md` the SVG is replaced by a grouped list. A US map at 340px wide
 *     is not a smaller map, it is an unreadable one — and a meaningful share of
 *     this traffic arrives from email and social on a phone.
 *
 * The map itself is `aria-hidden`: the visually-hidden list beneath it is the
 * real text alternative, because "map of the United States showing eleven
 * locations" is not an alternative to knowing which eleven.
 */

const THEME_FILL: Record<string, string> = {
  space: 'var(--color-space-violet)',
  enviro: 'var(--color-enviro-green)',
}

function LegendChip({
  label, count, dotClass, className,
}: { label: string; count: number; dotClass: string; className: string }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-ds-meta font-semibold ${className}`}>
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dotClass}`} />
      {label} {count}
    </span>
  )
}

/**
 * Nudge pins apart where two venues are close enough to render as one blob.
 *
 * Denver and Highlands Ranch are 25km apart, which is five units in a 960-wide
 * viewBox — two 7px dots almost exactly on top of each other, and in this case
 * one Environmental and one Space, so the overlap hides a whole theme. Left
 * alone it reads as a rendering fault rather than as two locations.
 *
 * Deterministic: input order is fixed by the query (live first, then planned by
 * state and city), so the same data always produces the same layout. The
 * displacement is a few pixels at most — far below the ~5km a pixel represents
 * at this scale, so no pin ends up in the wrong state.
 */
const MIN_GAP = 15

function spreadPins(
  pins: { location: MapLocation; x: number; y: number }[],
): { location: MapLocation; x: number; y: number }[] {
  const placed: { location: MapLocation; x: number; y: number }[] = []
  for (const pin of pins) {
    let { x, y } = pin
    for (const other of placed) {
      const dx = x - other.x
      const dy = y - other.y
      const dist = Math.hypot(dx, dy)
      if (dist >= MIN_GAP) continue
      // Directly coincident pins have no direction to separate along, so pick
      // one rather than dividing by zero.
      const angle = dist === 0 ? Math.PI / 4 : Math.atan2(dy, dx)
      const push = MIN_GAP - dist
      x += Math.cos(angle) * push
      y += Math.sin(angle) * push
    }
    placed.push({ location: pin.location, x, y })
  }
  return placed
}

function groupByState(locations: readonly MapLocation[]) {
  const byState = new Map<string, MapLocation[]>()
  for (const l of locations) {
    const list = byState.get(l.state) ?? []
    list.push(l)
    byState.set(l.state, list)
  }
  return [...byState.entries()].sort(([a], [b]) => a.localeCompare(b))
}

function describe(l: MapLocation): string {
  const where = l.venue ? `${l.venue}, ${l.city}, ${l.state}` : `${l.city}, ${l.state}`
  const theme = l.theme === 'enviro' ? 'Environmental Design' : 'Space Design'
  return `${where} — ${theme}, ${l.status === 'live' ? 'running now' : 'in planning'}`
}

export function LocationMap({
  locations, counts, headingId,
}: {
  locations: readonly MapLocation[]
  counts: LocationCounts
  headingId: string
}) {
  const pinned = spreadPins(
    locations.filter(hasPin).map((location) => ({ location, ...project(location.lat, location.lng) })),
  )

  return (
    <figure className="m-0">
      {/* Screen-reader text alternative. Present at every width, so the mobile
          list below is not the only way the content exists. */}
      <figcaption className="sr-only">
        Stellr competition locations. {counts.live} running now and {counts.planned} in
        planning, across {counts.states} states.
        <ul>
          {locations.map((l) => (
            <li key={l.id}>{describe(l)}</li>
          ))}
        </ul>
      </figcaption>

      <svg
        viewBox={`0 0 ${US_VIEWBOX.width} ${US_VIEWBOX.height}`}
        className="hidden h-auto w-full md:block"
        role="presentation"
        aria-hidden="true"
        focusable="false"
      >
        <g fill="var(--color-surface)" stroke="var(--color-border)" strokeWidth={1.1}>
          {US_STATE_PATHS.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        <g>
          {pinned.map(({ location: l, x, y }) => {
            const colour = THEME_FILL[l.theme] ?? THEME_FILL.space
            // A planned site reads as an outline, a running one as a solid dot:
            // status is legible without relying on hue at all.
            return l.status === 'live' ? (
              <circle key={l.id} cx={x} cy={y} r={7} fill={colour} stroke="var(--color-white)" strokeWidth={2} />
            ) : (
              <circle key={l.id} cx={x} cy={y} r={6} fill="var(--color-white)" stroke={colour} strokeWidth={2.5} strokeDasharray="3 2" />
            )
          })}
        </g>
      </svg>

      {/* Below md: the same data as a list. */}
      <div className="grid gap-4 md:hidden" aria-labelledby={headingId}>
        {groupByState(locations).map(([state, rows]) => (
          <div key={state}>
            <p className="font-display text-ds-meta font-bold uppercase tracking-eyebrow text-content-faint">
              {state}
            </p>
            <ul className="mt-1.5 grid gap-1.5">
              {rows.map((l) => (
                <li key={l.id} className="flex items-baseline gap-2.5 text-ds-body text-content-secondary">
                  <span
                    aria-hidden="true"
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={
                      l.status === 'live'
                        ? { background: THEME_FILL[l.theme] }
                        : { boxShadow: `inset 0 0 0 2px ${THEME_FILL[l.theme]}` }
                    }
                  />
                  <span>
                    <span className="font-semibold text-ink">{l.city}</span>
                    {l.venue ? ` · ${l.venue}` : ''}
                    {l.status === 'planned' ? ' · in planning' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </figure>
  )
}

export function LocationLegend({ counts }: { counts: LocationCounts }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <LegendChip
        label="Environmental" count={counts.enviro}
        dotClass="bg-enviro-green" className="bg-enviro-green-bg text-enviro-green-text"
      />
      <LegendChip
        label="Space" count={counts.space}
        dotClass="bg-space-violet" className="bg-space-violet-bg text-space-violet-text"
      />
      <LegendChip
        label="Planned" count={counts.planned}
        dotClass="bg-content-faint" className="bg-surface text-content-muted"
      />
    </div>
  )
}
