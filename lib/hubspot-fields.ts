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
  phone: 'phone',
  city: 'city',
  state: 'state',
  jobTitle: 'jobtitle',
  /** HubSpot's own standard property. The grant route writes the applicant's
   *  school here rather than adding a `grant_school_name` duplicate — and
   *  deliberately not to `company`, which can trigger company auto-association
   *  on what is a school name, not a customer. */
  school: 'school',

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

  // Teacher Grant Program (created by scripts/hubspot-setup.ts)
  grantProgramYear: 'grant_program_year',
  grantStatus: 'grant_status',
  grantApplicationDate: 'grant_application_date',
  grantPlannedActivities: 'grant_planned_activities',
  grantExpectedStudents: 'grant_expected_students',
  grantSubjects: 'grant_subjects',
  grantYearsTeaching: 'grant_years_teaching',
  grantPriorStellr: 'grant_prior_stellr',
  grantMotivation: 'grant_motivation',
  grantReferralSource: 'grant_referral_source',

  // Audience landing pages (/lp/[slug]) — created by scripts/hubspot-setup.ts.
  // `expected_student_count` is deliberately NOT grant_expected_students: that
  // one is scoped to a grant application, and reusing it would mix an enquiry's
  // rough group size into grant reporting.
  stellrRole: 'stellr_role',
  expectedStudentCount: 'expected_student_count',
  lpAudience: 'lp_audience',
  lpSourcePage: 'lp_source_page',
  lpProgramInterest: 'lp_program_interest',
  /** Set by the Motion booking webhook, never by the form. */
  lpCallBooked: 'lp_call_booked',
  // HubSpot keeps its own hs_analytics_source chain from the hutk, but that
  // chain is first-touch-weighted and gets overwritten. These explicit copies
  // are what make the per-page numbers survive.
  lpUtmSource: 'lp_utm_source',
  lpUtmMedium: 'lp_utm_medium',
  lpUtmCampaign: 'lp_utm_campaign',
  lpUtmContent: 'lp_utm_content',
  lpUtmTerm: 'lp_utm_term',
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
  teacher_grant: 'Teacher Grant',
  // One source for every audience landing page. Per-page reporting comes from
  // lp_audience and lp_source_page, so the next six pages need no new HubSpot
  // objects, no new workflows and no new form.
  landing_page: 'Landing Page',
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
  teacher_grant: 'HUBSPOT_FORM_TEACHER_GRANT',
  landing_page: 'HUBSPOT_FORM_LANDING_PAGE',
}

export function formIdFor(source: LeadSource): string | undefined {
  return process.env[FORM_ENV_VARS[source]] || undefined
}

/* ── Lifecycle stage intent ──────────────────────────────────────────────── */

/**
 * The lifecycle stage each route means a brand-new contact to land on.
 *
 * This cannot simply be written at capture time. A HubSpot form submission
 * stamps new contacts as **Lead**, and it does so *asynchronously* — seconds
 * after the submission returns — so a stage written inline is overwritten a
 * moment later. HubSpot then silently discards any write that moves a stage
 * backwards (verified against the portal: the PATCH returns 200 and nothing
 * changes), so it cannot be corrected by simply writing it again.
 *
 * The routes still pass these values, which is right for the property-write
 * fallback path where no form is involved. Where the form path is used, the
 * cron in app/api/cron/hubspot-lifecycle reconciles afterwards. Keeping the
 * intent here rather than inline in six routes is what lets the two agree.
 */
export const LEAD_SOURCE_LIFECYCLE: Record<LeadSource, 'subscriber' | 'lead'> = {
  // Signed up for information — not yet a lead.
  event_notify: 'subscriber',
  newsletter: 'subscriber',
  white_paper: 'subscriber',
  asset_request: 'subscriber',
  // Asked us for something that needs a person to respond.
  scholarship: 'lead',
  host_event: 'lead',
  teacher_grant: 'lead',
  // Every landing-page submission is a request for a call, so it is a lead from
  // the first touch — not a subscriber who might be marketed to later.
  landing_page: 'lead',
}

/** Routes whose contacts HubSpot will wrongly leave at Lead. */
export const SUBSCRIBER_LEAD_SOURCES = (
  Object.keys(LEAD_SOURCE_LIFECYCLE) as LeadSource[]
).filter((source) => LEAD_SOURCE_LIFECYCLE[source] === 'subscriber')

/* ── Notify status ───────────────────────────────────────────────────────── */

export const NOTIFY_STATUS = {
  requested: 'Requested',
  notified: 'Notified',
  registered: 'Registered',
  lapsed: 'Lapsed',
  /**
   * Opted out of waitlist mail. Distinct from `lapsed`, which means "never
   * converted" — conflating the two would let an unsubscribe be re-mailed by
   * anything that treats Lapsed as re-engageable. The send only ever targets
   * `Requested`, so this suppresses by construction.
   */
  unsubscribed: 'Unsubscribed',
} as const

export const REGISTRATION_INTEREST = {
  individual: 'Individual',
  group: 'Group',
  unspecified: 'Unspecified',
} as const

export type RegistrationInterest = keyof typeof REGISTRATION_INTEREST

export { GRANT_DEMOGRAPHIC } from '@/lib/grant'

/* ── Teacher Grant Program ────────────────────────────────────────────── */

/**
 * Stored values are the human labels, matching every other Stellr enumeration
 * in this file. The portal is read by people triaging a 15-place cohort, and a
 * column of `waitlist` / `both` reads as a bug where `Waitlist` / `Both` reads
 * as an answer.
 */
export const GRANT_STATUS = {
  applied: 'Applied',
  accepted: 'Accepted',
  waitlist: 'Waitlist',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
} as const

/**
 * What the applicant plans to run. A Competition is the umbrella; a Challenge is
 * the live form of it and a Campaign the remote-at-their-school form — so the
 * two options are Challenge and Campaign, never "Competition and Campaign".
 * See the vocabulary note in lib/grant.ts.
 */
export const GRANT_ACTIVITIES = {
  challenge: 'Challenge',
  campaign: 'Campaign',
  both: 'Both',
} as const

export const GRANT_PRIOR = {
  yes: 'Yes',
  no: 'No',
} as const

/**
 * HubSpot date properties store an epoch-millisecond value that must land on
 * **UTC midnight** — any other time-of-day is rejected outright. `Date.now()`
 * is therefore never a valid value for one.
 */
export function hubspotDateValue(date: Date): string {
  return String(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

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

/**
 * The school year an event belongs to — which is NOT its calendar year.
 *
 * Stellr's programme runs on a US school year, roughly August through May, and
 * everything in it is named for the year it *ends*: the Nevada Space Design
 * Challenge takes place in November 2026 but is a 2027 event, and its slug says
 * so. Deriving the calendar year instead tagged it `2026`, which meant
 * filtering `event_year = 2027` — the way anyone at Stellr would think to look
 * for it — returned nothing. That is precisely the segmentation failure this
 * mapping exists to prevent.
 *
 * August is the cutover. June and July fall outside the teaching year and are
 * treated as belonging to the year that just ended, rather than inventing a
 * boundary the business does not use.
 */
const SCHOOL_YEAR_START_MONTH = 7 // August, zero-indexed

export function schoolYearFor(date: Date): number {
  return date.getUTCMonth() >= SCHOOL_YEAR_START_MONTH
    ? date.getUTCFullYear() + 1
    : date.getUTCFullYear()
}

export function mapEventYear(input: {
  campaignYear?: number | null
  season?: string | null
  date?: string | null
}): string | undefined {
  let year: number | undefined

  // Campaigns carry `campaignYear`, which IS the school year — campaigns are
  // branded that way ("Fall 2027" = the autumn term of 2026/27). It therefore
  // maps straight onto `event_year` with no season arithmetic; `season` only
  // still gates the branch so a campaign missing one falls through to its date
  // rather than trusting a half-filled document.
  if (input.campaignYear && (input.season === 'fall' || input.season === 'spring')) {
    year = input.campaignYear
  }

  if (year === undefined && input.date && /^\d{4}-\d{2}-\d{2}/.test(input.date)) {
    year = schoolYearFor(new Date(`${input.date.slice(0, 10)}T00:00:00Z`))
  }

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
  /** 'fall' | 'spring' — proves the campaign year is a deliberate school year. */
  season?: string | null
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
