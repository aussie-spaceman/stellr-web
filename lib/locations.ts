// Where we run — the one derivation behind the landing pages' map, legend and
// prose counts.
//
// This exists because the handoff shipped a 3260x2093 raster with eleven pins
// and hard-coded labels, and four separate copy strings that each asserted
// "eleven locations across nine states — six running now, five in planning".
// Those numbers were already wrong against the dataset, and nothing made them
// agree with each other. Everything now derives from here, so the legend, the
// map and the sentence cannot drift apart again.
//
// The rule (docs/PLAN-landing-pages-2026-09-02.md §4):
//
//   live     a `live_event` with setting `in_person`, a `date`, a US state, and
//            `showOnLocationMap` not explicitly false
//   planned  a `plannedLocation` document
//
// An undated live event is a draft, not a venue — Providence RI has sat undated
// with a $0.51 test price since the August pricing work, and it must not appear
// on a marketing page. Non-US locations are excluded because this is a US map;
// the Uruguay event is real but has no pin to sit on.

import { client } from '@/lib/sanity'
import type { LpTheme } from '@/content/lp/types'

export type LocationStatus = 'live' | 'planned'

export interface MapLocation {
  /** Stable key for React and for the visually-hidden list. */
  id: string
  city: string
  /** Normalised to a USPS two-letter code. */
  state: string
  theme: LpTheme
  status: LocationStatus
  venue?: string
  lat: number
  lng: number
}

export interface LocationCounts {
  total: number
  states: number
  live: number
  planned: number
  /** Live locations only — the legend counts running events by theme. */
  space: number
  enviro: number
}

/* ── State normalisation ───────────────────────────────────────────────────
 * Sanity's `state` field is free text and the dataset proves it: "Colorado",
 * "CO", "NV", "South Dakota" and "Departamento de Maldonado" all coexist. A
 * distinct-state count over raw strings would report Colorado twice, so
 * normalise first — and use the same map to decide what counts as US at all. */
const US_STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC',
}
const US_CODES = new Set(Object.values(US_STATES))

/** USPS code for a US state written either way, else undefined (⇒ not US). */
export function normaliseState(raw?: string): string | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (trimmed.length === 2 && US_CODES.has(trimmed.toUpperCase())) return trimmed.toUpperCase()
  return US_STATES[trimmed.toLowerCase()]
}

/** Sanity's `type` (the competition theme) → the token-backed theme id. */
export function themeFor(type?: string): LpTheme {
  return type === 'Environmental Design Challenge' ? 'enviro' : 'space'
}

/* ── Fetch ─────────────────────────────────────────────────────────────────── */

interface EventRow {
  slug?: { current?: string }
  type?: string
  venue?: string
  city?: string
  state?: string
  latitude?: number
  longitude?: number
}

interface PlannedRow {
  _id: string
  slug?: { current?: string }
  theme?: LpTheme
  venue?: string
  city?: string
  state?: string
  latitude?: number
  longitude?: number
}

const LIVE_QUERY = `*[_type == "event"
  && (activityType == "live_event" || !defined(activityType))
  && setting == "in_person"
  && defined(date)
  && defined(city) && defined(state)
  && showOnLocationMap != false
] | order(date asc) {
  slug, type, venue, city, state, latitude, longitude
}`

const PLANNED_QUERY = `*[_type == "plannedLocation" && defined(city) && defined(state)]
  | order(state asc, city asc) {
  _id, slug, theme, venue, city, state, latitude, longitude
}`

/**
 * Every location the map should show, live first.
 *
 * A row with no coordinates is kept, not dropped: it still belongs in the
 * legend count and the text alternative, and the map simply has no pin for it.
 * Dropping it would silently understate how many places we run — and a pin
 * defaulted to (0, 0) would put a competition in the Gulf of Guinea.
 */
export async function getMapLocations(): Promise<MapLocation[]> {
  if (!client) return []

  const [events, planned] = await Promise.all([
    client.fetch<EventRow[]>(LIVE_QUERY),
    client.fetch<PlannedRow[]>(PLANNED_QUERY),
  ])

  const rows: MapLocation[] = []
  const seen = new Set<string>()

  function push(
    id: string,
    city: string | undefined,
    rawState: string | undefined,
    theme: LpTheme,
    status: LocationStatus,
    venue: string | undefined,
    lat: number | undefined,
    lng: number | undefined,
  ) {
    const state = normaliseState(rawState)
    // Not a US state ⇒ not on a US map. The Uruguay event is real; it has no
    // pin here, and the copy says "states" for a reason.
    if (!city || !state) return
    // Two events in one city collapse to one pin. A live row always wins over a
    // planned one for the same city, which is why live is loaded first.
    const key = `${city.toLowerCase()}|${state}`
    if (seen.has(key)) return
    seen.add(key)
    rows.push({
      id,
      city: city.trim(),
      state,
      theme,
      status,
      venue: venue?.trim() || undefined,
      lat: lat ?? Number.NaN,
      lng: lng ?? Number.NaN,
    })
  }

  for (const e of events ?? []) {
    push(
      e.slug?.current ?? `${e.city}-${e.state}`,
      e.city, e.state, themeFor(e.type), 'live', e.venue, e.latitude, e.longitude,
    )
  }
  for (const p of planned ?? []) {
    push(
      p.slug?.current ?? p._id,
      p.city, p.state, p.theme ?? 'space', 'planned', p.venue, p.latitude, p.longitude,
    )
  }

  return rows
}

/** True when this row has usable coordinates and can be drawn. */
export function hasPin(l: MapLocation): boolean {
  return Number.isFinite(l.lat) && Number.isFinite(l.lng)
}

export function countLocations(locations: readonly MapLocation[]): LocationCounts {
  const live = locations.filter((l) => l.status === 'live')
  return {
    total: locations.length,
    states: new Set(locations.map((l) => l.state)).size,
    live: live.length,
    planned: locations.length - live.length,
    space: live.filter((l) => l.theme === 'space').length,
    enviro: live.filter((l) => l.theme === 'enviro').length,
  }
}

/* ── Copy interpolation ────────────────────────────────────────────────────── */

const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen', 'twenty',
]

/** Spelled out up to twenty, then digits. The copy is prose, not a stat tile. */
export function numberWord(n: number): string {
  return WORDS[n] ?? String(n)
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Replace `{{locations}}`, `{{states}}`, `{{live}}` and `{{planned}}` in
 * approved copy with the derived figures. A capitalised token name
 * (`{{States}}`) yields a capitalised word, for sentence-initial use.
 *
 * An unknown token is left untouched rather than thrown on: this runs inside a
 * marketing page render, and a visible `{{typo}}` is a far better failure than
 * a 500 on the page the ads point at.
 */
export function fillCounts(text: string, counts: LocationCounts): string {
  const values: Record<string, number> = {
    locations: counts.total,
    states: counts.states,
    live: counts.live,
    planned: counts.planned,
  }
  return text.replace(/\{\{(\w+)\}\}/g, (whole, token: string) => {
    const key = token.charAt(0).toLowerCase() + token.slice(1)
    if (!(key in values)) return whole
    const word = numberWord(values[key])
    return token[0] === token[0].toUpperCase() ? capitalise(word) : word
  })
}
