// The one place age is worked out from a date of birth.
//
// There were six copies of "is this person a minor?" across lib/, and they
// disagreed: some parsed the date in local time, some approximated a year as
// 365.25 days, some compared against the event date. An agreement's signers
// depend on the answer, so e-signing uses this module and the remaining copies
// are being moved onto it (docs/PLAN-esign-2026-10-02.md, Phase 3).

/**
 * Dates of birth are date-only strings (YYYY-MM-DD). Parsing one with `new
 * Date()` yields UTC midnight, which is the previous evening in every US
 * timezone, so the parts are read straight from the string and compared with
 * `on` in UTC. A day's drift around midnight is immaterial; a systematic
 * off-by-one on every birthday is not.
 */
export function ageOn(dateOfBirth: string, on = new Date()): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth)
  if (!m) return 0
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])]
  let age = on.getUTCFullYear() - y
  const beforeBirthday =
    on.getUTCMonth() < mo || (on.getUTCMonth() === mo && on.getUTCDate() < d)
  if (beforeBirthday) age -= 1
  return age
}

export function isMinorOn(dateOfBirth: string | null | undefined, on = new Date()): boolean {
  if (!dateOfBirth) return false
  return ageOn(dateOfBirth, on) < 18
}

/** Under 13: the age below which a parent's consent has to come first. */
export function isUnder13On(dateOfBirth: string | null | undefined, on = new Date()): boolean {
  if (!dateOfBirth) return false
  return ageOn(dateOfBirth, on) < 13
}
