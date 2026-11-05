// Server-side age check for every route that writes a participant (S0, 2 Nov
// 2026). Before this, no registration route checked a date of birth: an empty
// or unreadable one gave `ageFromDob` NaN, NaN < 18 is false, and the person
// was stored with an adult role and age bracket. They were then sent an adult's
// agreement with no parent co-signing.
//
// The rules, the same in every route:
//   - The date of birth must be a real past date (YYYY-MM-DD). Anything else is
//     a 400 with a message the registrant can act on, before anything is written,
//     and a `code` (the refusal's `reason`) a client can tell apart.
//   - Age is worked out on the event's start date, or today when the event has
//     no usable date (a campaign).
//   - "Minor" for the role and bracket is under 18 on EITHER date, so a person
//     who is a minor when they register is never stored as an adult.
//   - An optional floor (`minAge`, on the event date). Stellr's own events have
//     none; tenant events will pass 14.
// No imports beyond lib/age, so the routes and the sheet sync can share it.

import { ageOn, appToday, isValidDob, onDate } from '@/lib/age'

/** Nobody registering is older than this; a year typed as 0211 or 1811 is a typo. */
export const MAX_AGE = 120

export interface RegistrationAgeOk {
  ok: true
  /** The date of birth as YYYY-MM-DD: write this, not the raw input. */
  dateOfBirth: string
  /** Age on the event's start date (today when the event has no usable date). */
  ageAtEvent: number
  /** Age today. */
  ageToday: number
  /** Under 18 today or at the event: takes the participant role and high-school bracket. */
  isMinor: boolean
}

export interface RegistrationAgeRefused {
  ok: false
  /** No date of birth; one that is not a real past date; or under the event's floor. */
  reason: 'dob_missing' | 'dob_invalid' | 'under_minimum_age'
  /** Safe to show the person filling in the form. */
  error: string
}

export type RegistrationAgeResult = RegistrationAgeOk | RegistrationAgeRefused

export interface RegistrationAgeOptions {
  /** The event's start date (YYYY-MM-DD, or a timestamp starting with one). */
  eventDate?: string | null
  /** Whose date of birth, for the message ("for Sam Lee"). Omit when it is the registrant's own. */
  name?: string
  /** Minimum age on the event date. Unset for Stellr's own events. */
  minAge?: number
  /** Today, for tests. */
  today?: Date
}

/** The day ages are worked out on: the event's start date, else today. */
export function registrationAgeDate(eventDate: string | null | undefined, today = appToday()): Date {
  return eventDate && /^\d{4}-\d{2}-\d{2}/.test(eventDate) ? onDate(eventDate) : today
}

/**
 * Check a submitted date of birth for a registration and work out the ages the
 * route needs. Never treats a missing or unreadable date as an adult: it fails,
 * and the route returns `error` as a 400 before writing anything.
 */
export function checkRegistrationAge(dateOfBirth: unknown, opts: RegistrationAgeOptions = {}): RegistrationAgeResult {
  const whose = opts.name?.trim()
  const raw = typeof dateOfBirth === 'string' ? dateOfBirth.trim() : ''
  if (!raw) {
    return {
      ok: false,
      reason: 'dob_missing',
      error: whose ? `Please add a date of birth for ${whose}.` : 'Please add your date of birth.',
    }
  }
  const today = opts.today ?? appToday()
  const dob = raw.slice(0, 10)
  const ageToday = isValidDob(raw) && /^\d{4}-\d{2}-\d{2}$/.test(dob) ? ageOn(dob, today) : NaN
  // isValidDob compares with the clock, so a date after `today` (in tests) is checked here too.
  if (!Number.isFinite(ageToday) || ageToday < 0 || ageToday > MAX_AGE || onDate(dob) > today) {
    return {
      ok: false,
      reason: 'dob_invalid',
      error: whose
        ? `The date of birth for ${whose} doesn't look right. Please check it and try again.`
        : "That date of birth doesn't look right. Please check it and try again.",
    }
  }
  const ageAtEvent = ageOn(dob, registrationAgeDate(opts.eventDate, today))
  if (opts.minAge != null && ageAtEvent < opts.minAge) {
    return {
      ok: false,
      reason: 'under_minimum_age',
      error: whose
        ? `${whose} must be ${opts.minAge} or older on the day of the event to take part.`
        : `You must be ${opts.minAge} or older on the day of the event to take part.`,
    }
  }
  return { ok: true, dateOfBirth: dob, ageAtEvent, ageToday, isMinor: Math.min(ageToday, ageAtEvent) < 18 }
}

/**
 * Under 18 for the role and bracket, failing closed: a date of birth that does
 * not pass checkRegistrationAge counts as a minor. For code that runs after the
 * route has already checked, so the fallback is a backstop, not a path.
 */
export function isRegistrationMinor(dateOfBirth: unknown, eventDate?: string | null): boolean {
  const r = checkRegistrationAge(dateOfBirth, { eventDate })
  return !r.ok || r.isMinor
}
