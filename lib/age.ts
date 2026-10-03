// The one place age is worked out from a date of birth.
//
// There were eight copies of "is this person a minor?" across the app, and
// they disagreed: some parsed the date in local time, some approximated a year
// as 365.25 days, one subtracted calendar years. An agreement's signers, the
// roster's consent pill and the background-check rule all depend on the
// answer, so every copy now calls this module (no imports: safe in the
// browser too).
//
// "Today" is the calendar date in Mountain time, where Stellr operates, so a
// birthday turns over at local midnight rather than at 6 pm the evening before.

const APP_TIME_ZONE = 'America/Denver'

/** A calendar date (YYYY-MM-DD, or anything starting with one) as the Date ageOn compares with. */
export function onDate(date: string | Date): Date {
  if (date instanceof Date) return date
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(date)
  return m ? new Date(`${m[1]}T12:00:00Z`) : new Date(date)
}

/** Today's date in Mountain time, at noon UTC so its UTC calendar parts are that date. */
export function appToday(now = new Date()): Date {
  return onDate(now.toLocaleDateString('en-CA', { timeZone: APP_TIME_ZONE }))
}

/** A usable date of birth: YYYY-MM-DD, a real date, not in the future. */
export function isValidDob(dateOfBirth: string | null | undefined): dateOfBirth is string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth ?? '')
  if (!m) return false
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`)
  return d.getUTCMonth() + 1 === Number(m[2]) && d.getTime() <= Date.now()
}

/**
 * Dates of birth are date-only strings (YYYY-MM-DD). Parsing one with `new
 * Date()` yields UTC midnight, which is the previous evening in every US
 * timezone, so the parts are read straight from the string and compared with
 * `on` in UTC. A day's drift around midnight is immaterial; a systematic
 * off-by-one on every birthday is not.
 */
export function ageOn(dateOfBirth: string, on = appToday()): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth)
  if (!m) return 0
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])]
  let age = on.getUTCFullYear() - y
  const beforeBirthday =
    on.getUTCMonth() < mo || (on.getUTCMonth() === mo && on.getUTCDate() < d)
  if (beforeBirthday) age -= 1
  return age
}

/**
 * The age of majority in a US state (Participation Agreements V2.3, "Minor"):
 * 19 in Alabama and Nebraska, 21 in Mississippi, 18 everywhere else and when
 * the state is not known. Accepts a two-letter code or the full name.
 */
export function ageOfMajority(state?: string | null): number {
  const s = (state ?? '').trim().toUpperCase()
  if (s === 'AL' || s === 'ALABAMA' || s === 'NE' || s === 'NEBRASKA') return 19
  if (s === 'MS' || s === 'MISSISSIPPI') return 21
  return 18
}

/**
 * Under the age of majority on `on`. Pass the state where the person lives
 * when it is known; without it, 18 applies. (Students still in high school
 * are Minors at any age under the agreements; callers decide that by role.)
 */
export function isMinorOn(dateOfBirth: string | null | undefined, on = appToday(), state?: string | null): boolean {
  // Unknown or unreadable: not assumed a minor (every caller already treats it so).
  if (!isValidDob(dateOfBirth)) return false
  return ageOn(dateOfBirth, on) < ageOfMajority(state)
}

/** Under 13: the age below which a parent's consent has to come first. */
export function isUnder13On(dateOfBirth: string | null | undefined, on = appToday()): boolean {
  if (!isValidDob(dateOfBirth)) return false
  return ageOn(dateOfBirth, on) < 13
}
