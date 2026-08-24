// Teacher Stipend Program — the numbers the page and the API route must agree on.
//
// The program is a fixed, budgeted pilot: 15 places, $500 maximum per teacher,
// $7,500 total exposure. Those figures appear in the marketing copy, in the
// participation agreement, and in what the route stamps on a HubSpot contact,
// so they live in one place rather than being retyped in three.
//
// Note what is deliberately NOT here: the Catalyst membership price. Tier
// prices are resolved live from Stripe via lib/tier-pricing.ts — a marketing
// surface must never hard-code one (see that file's header).
//
// ── Vocabulary ──────────────────────────────────────────────────────────────
// Three words, one hierarchy, and they are not interchangeable:
//
//   Competition  the umbrella. A team joins a Competition.
//   Challenge    a Competition run LIVE, at a venue the teacher travels to.
//   Campaign     a Competition run REMOTELY, at the teacher's own school.
//
// So "one Challenge and one Campaign per year" is right and "one Competition
// and one Campaign" is wrong — the second names a category and one of its own
// members as if they were siblings.

/** Calendar year of the current cohort. Calendar, not school year: the stipend
 *  runs Jan–Dec and pays on 31 May, unlike events, which are named for the
 *  school year they end in (see schoolYearFor in lib/hubspot-fields.ts). */
export const STIPEND_PROGRAM_YEAR = '2027'

/** Cohort size. Enforced by hand for the pilot — the form does not close itself. */
export const STIPEND_PLACES = 15

/** What each milestone pays, in whole dollars. */
export const STIPEND_AMOUNTS = {
  onboarding: 50,
  /** A live Challenge — the teacher brings a team to a venue. */
  challenge: 200,
  /** A Campaign — the Competition run remotely at the teacher's own school. */
  campaign: 200,
  closeOut: 50,
  annualMaximum: 500,
} as const

/** Minimum participants for each earning activity. */
export const STIPEND_THRESHOLDS = {
  /** Students who must *attend* a live Challenge, plus the teacher — six people. */
  challengeStudents: 5,
  /** Students who must be *registered* for a Campaign. */
  campaignStudents: 8,
} as const

export const STIPEND_PAYMENT_DATE = '31 May'

export const STIPEND_PD_HOURS = '10–20'

/** Dollar amount as it appears in copy: "$200". */
export function stipendAmount(value: number): string {
  return '$' + value.toLocaleString('en-US')
}

/**
 * Two-thirds of a cohort, rounded up — the close-out threshold.
 * Worked examples used in the published copy: 5 students → 4, 8 students → 6.
 */
export function closeOutThreshold(students: number): number {
  return Math.ceil((students * 2) / 3)
}

/**
 * The stipend is open to high school teachers only, so there is nothing to ask:
 * every applicant's demographic is known before they start typing. Written to
 * the portal's existing `event_demographic` rather than a parallel
 * `stipend_grade_levels`, so a teacher and the events serving their students
 * land in one segment instead of two that need reconciling.
 */
export const STIPEND_DEMOGRAPHIC = 'High School'
