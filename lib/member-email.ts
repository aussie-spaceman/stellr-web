// Personal and school email for members under 18 (4 Nov 2026).
//
// A student registered twice: once with a school address, whose network blocked
// the consent form, then again with a personal one. So members under 18 are
// asked for both, and the PERSONAL address always takes primacy:
//
//   members.email         the primary address (login matching, consent forms,
//                         receipts, sheet sync). Personal when given, else school.
//   members.school_email  the school address, kept for reference. Nothing is
//                         sent to it while a personal address is on file.
//
// Adults see the single Email field they always have. Pure and dependency-free
// apart from lib/age, so client forms and server routes share it.

import { isKnownMinorOn } from '@/lib/age'

/** Shown beside the pair wherever it is asked for. */
export const SCHOOL_EMAIL_NOTE =
  'Use a personal email if you can. School networks often block emails from Stellr services such as permission forms and payments, so a school address may never receive them.'

export const PERSONAL_EMAIL_LABEL = 'Personal email'
export const SCHOOL_EMAIL_LABEL = 'School email'

/** Ask for the Personal + School pair? Driven by the date of birth: under 18
 *  on a known DOB. With no DOB yet the form shows the ordinary Email field,
 *  whose value becomes the personal address once a minor's DOB is entered. */
export function showsSchoolEmail(dateOfBirth: string | null | undefined): boolean {
  return isKnownMinorOn(dateOfBirth ?? null)
}

function clean(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : ''
}

/** The primary address: personal when given, else school. '' when neither. */
export function primaryEmail(personal: unknown, school: unknown): string {
  return clean(personal) || clean(school)
}

/** The school address to store: '' unless one was given. */
export function schoolEmailToStore(school: unknown): string | null {
  return clean(school) || null
}

/**
 * Resolve a submitted pair into the two stored values. `email` is required by
 * the callers, so a minor must give at least one address.
 */
export function resolveEmailPair(input: { email?: unknown; school_email?: unknown }): {
  email: string
  school_email: string | null
} {
  return {
    email: primaryEmail(input.email, input.school_email),
    school_email: schoolEmailToStore(input.school_email),
  }
}

// Domains that are, or look like, a school's. A heuristic for the merge review
// (which address of two is the school one); the admin confirms it.
const SCHOOL_DOMAIN_PATTERNS: RegExp[] = [
  /\.k12\./,             // district.k12.co.us
  /\.edu$/,              // .edu
  /\.edu\.[a-z]{2}$/,    // .edu.au
  /\.sch\.[a-z]{2}$/,    // .sch.uk
  /\.school(\.|$)/,
  /(^|\.)(ccsd|lausd|cps|dpsk12|jeffco|apsva|fcps|mcpsmd|pps|isd\d*|usd\d*)\./,
  /(^|\.)(students?|stu|learners?|pupils?)\./,
  /(^|\.)[a-z]*(isd|usd|csd|sd)\d*\.(org|net|us)$/,
]

/** Does this address look like a school one? */
export function isLikelySchoolEmail(email: string | null | undefined): boolean {
  const domain = clean(email).split('@')[1] ?? ''
  if (!domain) return false
  return SCHOOL_DOMAIN_PATTERNS.some((re) => re.test(domain))
}
