/** Full month-day-year, e.g. "July 8, 2026". Handles both bare calendar dates
 *  ("YYYY-MM-DD", rendered in UTC so the day never shifts) and full timestamps
 *  (localised to APP_TIME_ZONE). Uses the fixed app locale/zone so SSR and the
 *  browser agree (see APP_TIME_ZONE note above). */
export function formatDate(dateStr: string): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
  return new Date(dateStr).toLocaleDateString(APP_LOCALE, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: dateOnly ? 'UTC' : APP_TIME_ZONE,
  })
}

// Fixed app timezone + locale so a date/time renders identically on the server
// and on the client. Bare `.toLocaleDateString()`/`.toLocaleString()` inherit the
// runtime's locale and timezone, which differ between the SSR host (UTC) and the
// browser — causing React #418 hydration errors and inconsistent day/format.
// Stellr is a US (Utah) organisation, so dates render in US format + Mountain
// Time. Change this single constant if the organisation operates in another
// timezone.
export const APP_TIME_ZONE = 'America/Denver'
export const APP_LOCALE = 'en-US'

/** Month-day-year for a timestamp/ISO string, e.g. "Jun 20, 2026".
 *
 * A bare calendar date ("YYYY-MM-DD", e.g. a Postgres `date` column like a
 * membership's started_at) has no time or zone. `new Date("2026-07-08")` parses
 * it as UTC midnight, so rendering it in APP_TIME_ZONE (Mountain) shifts it back
 * a day ("Jul 7"). Render those in UTC so the calendar date is preserved; only
 * true timestamps are localised to APP_TIME_ZONE. */
export function formatDateShort(iso: string | number | Date): string {
  const dateOnly = typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso)
  return new Date(iso).toLocaleDateString(APP_LOCALE, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: dateOnly ? 'UTC' : APP_TIME_ZONE,
  })
}

/** Date + time for a timestamp/ISO string, e.g. "Jun 20, 2026, 10:00 AM". */
export function formatDateTime(iso: string | number | Date): string {
  return new Date(iso).toLocaleString(APP_LOCALE, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: APP_TIME_ZONE,
  })
}

export function formatDateRange(start: string, end?: string): string {
  if (!end || start === end) return formatDate(start)
  // Anchor both ends to UTC midnight and read/format in UTC, so a bare calendar
  // date never shifts a day between the SSR host (UTC) and the browser.
  const s = new Date(start + 'T00:00:00Z')
  const e = new Date(end + 'T00:00:00Z')
  if (s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear()) {
    return `${s.toLocaleDateString(APP_LOCALE, { month: 'long', day: 'numeric', timeZone: 'UTC' })}–${e.getUTCDate()}, ${e.getUTCFullYear()}`
  }
  return `${formatDate(start)} – ${formatDate(end)}`
}

/**
 * Live-event registration state, derived purely from the Open/Close dates:
 *   • open date in the future  → 'coming-soon'
 *   • close date in the past   → 'closed'
 *   • otherwise (incl. no dates set) → 'open'
 *
 * There is no manual on/off switch for live events — an event with neither date
 * set is open (per the Public Pages spec). Campaigns are different: they carry a
 * manual `registrationOpen` toggle, so their callers resolve status themselves.
 */
export function registrationStatus(
  openDate?: string,
  closeDate?: string
): 'open' | 'coming-soon' | 'closed' {
  const now = new Date()
  const isDateOnly = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)
  // Sanity's `date` fields are bare "YYYY-MM-DD" (no time/zone). Comparing them
  // with `new Date(s)` parses at UTC midnight, so "Closes July 10" flipped to
  // `closed` at 6 PM Mountain on July 9 — ~30h early, silently costing sign-ups.
  // For a date-only bound, compare CALENDAR days in APP_TIME_ZONE: registration
  // is open through the whole close day (Mountain) and opens at the start of the
  // open day (Mountain). Full timestamps keep exact-instant comparison.
  const todayMT = todayInAppZone()
  if (openDate) {
    if (isDateOnly(openDate)) { if (openDate > todayMT) return 'coming-soon' }
    else if (new Date(openDate) > now) return 'coming-soon'
  }
  if (closeDate) {
    if (isDateOnly(closeDate)) { if (closeDate < todayMT) return 'closed' }
    else if (new Date(closeDate) < now) return 'closed'
  }
  return 'open'
}

/** "Now" as a "YYYY-MM-DD" calendar date in APP_TIME_ZONE (en-CA gives ISO
 *  order). Used to compare bare calendar dates without UTC-midnight drift. */
export function todayInAppZone(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

/** Whole years old as of today (APP_TIME_ZONE), accounting for month AND day.
 *
 * Year-subtraction (`thisYear - birthYear`) over-counts anyone whose birthday
 * hasn't occurred yet this year — e.g. a Dec-2008 DOB reads as 18 in mid-2026
 * when the person is still 17. That misclassification skips the minor→participant
 * role override and the guardian/parental-consent requirement, so age must be
 * exact here. A bare "YYYY-MM-DD" DOB is anchored to UTC to avoid a day shift. */
export function ageFromDob(dob: string | Date): number {
  const birth = typeof dob === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dob)
    ? new Date(dob + 'T00:00:00Z')
    : new Date(dob)
  if (Number.isNaN(birth.getTime())) return NaN
  const [ty, tm, td] = todayInAppZone().split('-').map(Number)
  const by = birth.getUTCFullYear()
  const bm = birth.getUTCMonth() + 1
  const bd = birth.getUTCDate()
  let age = ty - by
  if (tm < bm || (tm === bm && td < bd)) age -= 1
  return age
}
