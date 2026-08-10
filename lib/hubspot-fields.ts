// Canonical HubSpot contact-property names and the Sanity → HubSpot value
// mappings used by every stellreducation.org lead route.
//
// HubSpot is the source of truth for leads, so this module is the single place
// where our vocabulary is translated into the portal's. Two rules hold
// throughout:
//
//   1. Never guess. If a Sanity value has no known HubSpot counterpart we
//      return undefined and log it — a blank property is recoverable, a wrong
//      one silently poisons a segment.
//   2. Never write machine-readable data into `message`. That property is
//      shared free text and is clobbered by whichever lead route fires last.
//
// Property definitions live in scripts/hubspot-setup.ts; keep the two in sync.

/* ── Property names ──────────────────────────────────────────────────────── */

export const HS = {
  // Standard/identity
  email: 'email',
  firstName: 'firstname',
  lastName: 'lastname',
  lifecycleStage: 'lifecyclestage',
  leadStatus: 'hs_lead_status',

  // Pre-existing Stellr event taxonomy (created in-portal, previously unwritten)
  eventLocation: 'event',
  eventYear: 'event_year',
  eventTheme: 'event_theme',
  eventDemographic: 'event_demographic',

  // Created by scripts/hubspot-setup.ts
  eventSlug: 'event_slug',
  notifyRequestedDate: 'event_notify_requested_date',
  notifyLog: 'event_notify_log',
  notifyStatus: 'event_notify_status',
  registrationInterest: 'registration_interest_type',
  leadSource: 'stellr_lead_source',
} as const

/* ── Lead sources ────────────────────────────────────────────────────────── */

/** One per public lead route. Values double as `stellr_lead_source` options. */
export const LEAD_SOURCES = {
  event_notify: 'Event Notify',
  newsletter: 'Newsletter',
  white_paper: 'White Paper',
  asset_request: 'Asset Request',
  scholarship: 'Scholarship',
  host_event: 'Host An Event',
} as const

export type LeadSource = keyof typeof LEAD_SOURCES

/**
 * Env var holding each route's HubSpot form GUID. When a GUID is absent the
 * capture falls back to a direct property write, so the site keeps working
 * before the forms exist in the portal — it just loses conversion attribution
 * until they do.
 */
export const FORM_ENV_VARS: Record<LeadSource, string> = {
  event_notify: 'HUBSPOT_FORM_EVENT_NOTIFY',
  newsletter: 'HUBSPOT_FORM_NEWSLETTER',
  white_paper: 'HUBSPOT_FORM_WHITE_PAPER',
  asset_request: 'HUBSPOT_FORM_ASSET_REQUEST',
  scholarship: 'HUBSPOT_FORM_SCHOLARSHIP',
  host_event: 'HUBSPOT_FORM_HOST_EVENT',
}

export function formIdFor(source: LeadSource): string | undefined {
  return process.env[FORM_ENV_VARS[source]] || undefined
}

/* ── Notify status ───────────────────────────────────────────────────────── */

export const NOTIFY_STATUS = {
  requested: 'Requested',
  notified: 'Notified',
  registered: 'Registered',
  lapsed: 'Lapsed',
} as const

export const REGISTRATION_INTEREST = {
  individual: 'Individual',
  group: 'Group',
  unspecified: 'Unspecified',
} as const

export type RegistrationInterest = keyof typeof REGISTRATION_INTEREST

/* ── Sanity → HubSpot: event location ────────────────────────────────────── */

/** The exact `event` (Event Location) options defined in the portal. */
const LOCATION_VIRTUAL = 'Virtual [Zoom + Discord]'

/**
 * Keyed on the Sanity `state` field, which the event pages render as
 * `${city}, ${state}` — in practice a two-letter code, though full names are
 * accepted too. Where one state could host more than one venue the city
 * disambiguates; see LOCATION_BY_CITY.
 */
const LOCATION_BY_STATE: Record<string, string> = {
  nv: 'Nevada [Las Vegas]',
  nevada: 'Nevada [Las Vegas]',
  co: 'Colorado [Denver]',
  colorado: 'Colorado [Denver]',
  nc: 'North Carolina [Raleigh]',
  'north carolina': 'North Carolina [Raleigh]',
  sd: 'South Dakota [Brookings]',
  'south dakota': 'South Dakota [Brookings]',
  mn: 'Minnesota [Mankato]',
  minnesota: 'Minnesota [Mankato]',
  tx: 'Texas [Houston]',
  texas: 'Texas [Houston]',
  pa: 'Pennsylvania [Lehigh]',
  pennsylvania: 'Pennsylvania [Lehigh]',
  ne: 'Nebraska [SAC Museum]',
  nebraska: 'Nebraska [SAC Museum]',
  az: 'Arizona [BS2]',
  arizona: 'Arizona [BS2]',
  wa: 'Washington State [Raisbeck]',
  washington: 'Washington State [Raisbeck]',
  'washington state': 'Washington State [Raisbeck]',
  uruguay: 'Uruguay',
}

/** City overrides, checked before state — for the non-geographic options. */
const LOCATION_BY_CITY: Record<string, string> = {
  'las vegas': 'Nevada [Las Vegas]',
  denver: 'Colorado [Denver]',
  raleigh: 'North Carolina [Raleigh]',
  brookings: 'South Dakota [Brookings]',
  mankato: 'Minnesota [Mankato]',
  houston: 'Texas [Houston]',
  lehigh: 'Pennsylvania [Lehigh]',
  bethlehem: 'Pennsylvania [Lehigh]',
  montevideo: 'Uruguay',
}

export function mapEventLocation(input: {
  setting?: string | null
  city?: string | null
  state?: string | null
  title?: string | null
}): string | undefined {
  if (input.setting === 'virtual') return LOCATION_VIRTUAL

  // ISSDC Finals is identified by name rather than venue — it moves each year.
  if (input.title && /issdc/i.test(input.title)) return 'ISSDC Finals'

  const city = input.city?.trim().toLowerCase()
  if (city && LOCATION_BY_CITY[city]) return LOCATION_BY_CITY[city]

  const state = input.state?.trim().toLowerCase()
  if (state && LOCATION_BY_STATE[state]) return LOCATION_BY_STATE[state]

  return undefined
}

/* ── Sanity → HubSpot: theme ─────────────────────────────────────────────── */

/**
 * Sanity stores the full challenge name; HubSpot stores the theme. Matched on
 * a leading keyword so new Sanity variants ("Space Design Challenge — Finals")
 * still resolve.
 */
const THEME_PATTERNS: [RegExp, string][] = [
  [/space/i, 'Space'],
  [/environment/i, 'Environmental'],
  [/life\s*science|biolog/i, 'Life Sciences'],
  [/resource/i, 'Resources'],
]

export function mapEventTheme(sanityType?: string | null): string | undefined {
  if (!sanityType) return undefined
  return THEME_PATTERNS.find(([re]) => re.test(sanityType))?.[1]
}

/* ── Sanity → HubSpot: demographic ───────────────────────────────────────── */

/**
 * `event_demographic` is a multi-checkbox in the portal (converted by
 * scripts/hubspot-setup.ts) precisely so Sanity's "Both" can be represented
 * honestly rather than collapsed to one grade band. HubSpot delimits
 * multi-select values with a semicolon.
 */
export function mapEventDemographic(gradeLevel?: string | null): string | undefined {
  switch (gradeLevel?.trim()) {
    case 'Middle School':
      return 'Middle School'
    case 'High School':
      return 'High School'
    case 'Both':
      return 'Middle School;High School'
    case 'College':
      return 'College'
    default:
      return undefined
  }
}

/* ── Sanity → HubSpot: year ──────────────────────────────────────────────── */

/**
 * `event_year` is an enumeration, so an unlisted year would be rejected.
 * scripts/hubspot-setup.ts extends the option list; this guard keeps us inside
 * a sane range rather than trusting whatever a date field holds.
 */
const YEAR_MIN = 2023
const YEAR_MAX = 2030

export function mapEventYear(input: {
  campaignYear?: number | null
  date?: string | null
}): string | undefined {
  const year =
    input.campaignYear ??
    (input.date && /^\d{4}/.test(input.date) ? Number(input.date.slice(0, 4)) : undefined)

  if (!year || year < YEAR_MIN || year > YEAR_MAX) return undefined
  return String(year)
}

/* ── Composite ───────────────────────────────────────────────────────────── */

export interface EventLike {
  title?: string | null
  type?: string | null
  gradeLevel?: string | null
  setting?: string | null
  city?: string | null
  state?: string | null
  date?: string | null
  campaignYear?: number | null
}

/**
 * Build the `event_*` property patch for a Sanity event. Unmappable fields are
 * omitted (never guessed) and reported so a missing portal option shows up in
 * logs instead of as a silently blank segment.
 */
export function eventProperties(
  event: EventLike,
  slug: string,
): { properties: Record<string, string>; unmapped: string[] } {
  const properties: Record<string, string> = { [HS.eventSlug]: slug }
  const unmapped: string[] = []

  const location = mapEventLocation(event)
  if (location) properties[HS.eventLocation] = location
  else unmapped.push(`location(setting=${event.setting}, city=${event.city}, state=${event.state})`)

  const year = mapEventYear(event)
  if (year) properties[HS.eventYear] = year
  else unmapped.push(`year(campaignYear=${event.campaignYear}, date=${event.date})`)

  const theme = mapEventTheme(event.type)
  if (theme) properties[HS.eventTheme] = theme
  else unmapped.push(`theme(type=${event.type})`)

  const demographic = mapEventDemographic(event.gradeLevel)
  if (demographic) properties[HS.eventDemographic] = demographic
  else unmapped.push(`demographic(gradeLevel=${event.gradeLevel})`)

  return { properties, unmapped }
}
