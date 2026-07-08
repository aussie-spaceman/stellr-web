export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
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
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${s.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}–${e.getDate()}, ${e.getFullYear()}`
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
  if (openDate && new Date(openDate) > now) return 'coming-soon'
  if (closeDate && new Date(closeDate) < now) return 'closed'
  return 'open'
}
