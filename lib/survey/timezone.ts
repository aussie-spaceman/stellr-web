/**
 * An event's time zone. Sanity stores no zone for events (checked 2 Oct
 * 2026), so it is derived from the event's US state; states that span two
 * zones use the zone most of their population lives in. Anything else — no
 * state, outside the US — falls back to the app's zone, America/Denver.
 */
import { normaliseState } from '@/lib/locations'

export const DEFAULT_TIME_ZONE = 'America/Denver'

const STATE_ZONES: Record<string, string> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago',
  CA: 'America/Los_Angeles', CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York',
  DC: 'America/New_York', FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu',
  ID: 'America/Boise', IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis', IA: 'America/Chicago',
  KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York',
  MD: 'America/New_York', MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago',
  MS: 'America/Chicago', MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago',
  NV: 'America/Los_Angeles', NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver',
  NY: 'America/New_York', NC: 'America/New_York', ND: 'America/Chicago', OH: 'America/New_York',
  OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago',
  UT: 'America/Denver', VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles',
  WV: 'America/New_York', WI: 'America/Chicago', WY: 'America/Denver', PR: 'America/Puerto_Rico',
}

export function eventTimeZone(event: { state?: string | null; country?: string | null; timeZone?: string | null }): string {
  if (event.timeZone && isValidTimeZone(event.timeZone)) return event.timeZone
  const country = (event.country ?? '').trim().toUpperCase()
  if (country && country !== 'US' && country !== 'USA') return DEFAULT_TIME_ZONE
  const code = event.state ? normaliseState(event.state) : null
  return (code && STATE_ZONES[code]) || DEFAULT_TIME_ZONE
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Offset of `tz` from UTC at instant `at`, in minutes (Denver in summer → -360). */
function offsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((asUtc - at.getTime()) / 60_000)
}

/** The UTC instant of local wall-clock `date` (YYYY-MM-DD) at `hh:mm` in `tz`. */
export function zonedTimeToUtc(date: string, tz: string, hh = 0, mm = 0): Date {
  const [y, m, d] = date.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  // Two passes settle DST edges (the offset at the guess may differ from the result's).
  let at = new Date(guess - offsetMinutes(tz, new Date(guess)) * 60_000)
  at = new Date(guess - offsetMinutes(tz, at) * 60_000)
  return at
}

/** YYYY-MM-DD of an instant in `tz`. */
export function localDate(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

/** "Sat 10 Oct, 12:00 am MDT" — for admin screens and emails. */
export function formatInZone(at: Date | string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(typeof at === 'string' ? new Date(at) : at)
}

/** "10 November 2026" in `tz`. */
export function formatDateInZone(at: Date | string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, day: 'numeric', month: 'long', year: 'numeric' }).format(
    typeof at === 'string' ? new Date(at) : at,
  )
}
