/**
 * grade-logic.ts
 * -----------------------------------------------------------------------------
 * Estimate a US K-12 school grade from a student's Date of Birth + State.
 * Ported from the `grade_logic.js` reference script (Claude Cowork) into the app.
 *
 * THIS IS AN ESTIMATE, NOT GROUND TRUTH. It is used to PRE-FILL the Grade field
 * on the public event-registration form, which the registrant can override.
 *
 * Core rule:
 *   grade = fallYear - (birthYear + 5 + (bornAfterCutoff ? 1 : 0))   // K = 0
 * -----------------------------------------------------------------------------
 */

export interface StateCutoff {
  month: number
  day: number
  confidence: 'high' | 'medium' | 'verify'
  note: string
}

/**
 * State entry-cutoff table. A child must turn 5 ON OR BEFORE {month}/{day} to
 * start Kindergarten that fall. September 1 is the safe default (29 states).
 * District-level cutoffs frequently override these; treat as a starting point.
 */
export const STATE_CUTOFFS: Record<string, StateCutoff> = {
  Alabama:               { month: 9,  day: 1,  confidence: 'high',   note: '' },
  Alaska:                { month: 8,  day: 31, confidence: 'medium', note: 'Nominal Sep 1; source lists Aug 31' },
  Arizona:               { month: 9,  day: 1,  confidence: 'high',   note: 'Early-entrance testing available' },
  Arkansas:              { month: 9,  day: 1,  confidence: 'high',   note: '' },
  California:            { month: 9,  day: 1,  confidence: 'high',   note: 'TK bridge year for Sep 2 - Dec 2 birthdays' },
  Colorado:             { month: 9,  day: 1,  confidence: 'high',   note: 'Districts may set earlier dates' },
  Connecticut:          { month: 9,  day: 1,  confidence: 'high',   note: 'Changed from Jan 1 to Sep 1 effective 2024-25' },
  Delaware:             { month: 9,  day: 1,  confidence: 'high',   note: '' },
  'District of Columbia': { month: 10, day: 15, confidence: 'medium', note: 'Turn 5 by Oct 15' },
  Florida:              { month: 9,  day: 1,  confidence: 'high',   note: 'No early-entrance exceptions' },
  Georgia:              { month: 9,  day: 1,  confidence: 'high',   note: 'Early-entrance testing available' },
  Hawaii:               { month: 8,  day: 15, confidence: 'medium', note: 'Source lists Aug 15; HI used Jul 31/Aug 1 historically' },
  Idaho:                { month: 9,  day: 1,  confidence: 'high',   note: '' },
  Illinois:             { month: 9,  day: 1,  confidence: 'high',   note: 'Some districts set their own policy' },
  Indiana:              { month: 8,  day: 1,  confidence: 'high',   note: 'Earliest cutoff in US (Aug 1)' },
  Iowa:                 { month: 9,  day: 1,  confidence: 'high',   note: 'Moves to Sep 15 effective 2026-27' },
  Kansas:               { month: 9,  day: 1,  confidence: 'verify', note: 'Source inconsistent (Sep 1 vs Aug 31)' },
  Kentucky:             { month: 9,  day: 30, confidence: 'verify', note: 'Source inconsistent (Sep 30 vs Oct 1)' },
  Louisiana:            { month: 9,  day: 1,  confidence: 'high',   note: '' },
  Maine:                { month: 9,  day: 1,  confidence: 'high',   note: 'Oct 15 local option' },
  Maryland:             { month: 10, day: 1,  confidence: 'verify', note: 'Source inconsistent (Oct 1 vs Sep 1); statute commonly Sep 1' },
  Massachusetts:        { month: 9,  day: 1,  confidence: 'high',   note: 'Districts may vary' },
  Michigan:             { month: 9,  day: 30, confidence: 'verify', note: 'Source inconsistent (Sep 30 vs Sep 1); waiver option' },
  Minnesota:            { month: 9,  day: 1,  confidence: 'high',   note: '' },
  Mississippi:          { month: 9,  day: 30, confidence: 'verify', note: 'Source inconsistent (Sep 30 vs Sep 1)' },
  Missouri:             { month: 8,  day: 1,  confidence: 'high',   note: 'Tied for earliest cutoff (Aug 1)' },
  Montana:              { month: 9,  day: 1,  confidence: 'high',   note: 'Source note mentions Sep 10' },
  Nebraska:             { month: 9,  day: 1,  confidence: 'high',   note: 'Jul 31 for some districts' },
  Nevada:               { month: 8,  day: 31, confidence: 'verify', note: 'Source inconsistent (Aug 31 vs Sep 30)' },
  'New Hampshire':      { month: 9,  day: 1,  confidence: 'high',   note: 'Local districts set dates' },
  'New Jersey':         { month: 10, day: 1,  confidence: 'medium', note: 'District-set; Oct 1 common, may be earlier' },
  'New Mexico':         { month: 9,  day: 1,  confidence: 'high',   note: 'Aug 31 nominal' },
  'New York':           { month: 12, day: 1,  confidence: 'medium', note: 'District-set; NYC uses Dec 31' },
  'North Carolina':     { month: 9,  day: 30, confidence: 'verify', note: 'Source inconsistent (Sep 30 vs Aug 31)' },
  'North Dakota':       { month: 9,  day: 1,  confidence: 'high',   note: '' },
  Ohio:                 { month: 9,  day: 1,  confidence: 'verify', note: 'District-set; new law ties to first day of instruction from 2026-27' },
  Oklahoma:             { month: 9,  day: 30, confidence: 'verify', note: 'Source inconsistent (Sep 30 vs Sep 1)' },
  Oregon:               { month: 9,  day: 1,  confidence: 'high',   note: '' },
  Pennsylvania:         { month: 9,  day: 1,  confidence: 'verify', note: 'District determines; Sep 1 common (source primary said Oct 1)' },
  'Rhode Island':       { month: 9,  day: 30, confidence: 'verify', note: 'Source inconsistent (Sep 30 vs Sep 1)' },
  'South Carolina':     { month: 9,  day: 30, confidence: 'verify', note: 'Source inconsistent (Sep 30 vs Sep 1)' },
  'South Dakota':       { month: 9,  day: 1,  confidence: 'high',   note: '' },
  Tennessee:            { month: 8,  day: 15, confidence: 'verify', note: 'Source inconsistent (Sep 10 vs Aug 15)' },
  Texas:                { month: 9,  day: 1,  confidence: 'high',   note: '' },
  Utah:                 { month: 9,  day: 1,  confidence: 'high',   note: '' },
  Vermont:              { month: 9,  day: 1,  confidence: 'high',   note: 'Locally determined' },
  Virginia:             { month: 9,  day: 30, confidence: 'medium', note: 'Sep 30 statute' },
  Washington:           { month: 9,  day: 1,  confidence: 'high',   note: 'Aug 31 nominal' },
  'West Virginia':      { month: 9,  day: 30, confidence: 'verify', note: 'Source inconsistent (Sep 30 vs Jul 1)' },
  Wisconsin:            { month: 9,  day: 1,  confidence: 'high',   note: '' },
  Wyoming:              { month: 9,  day: 15, confidence: 'medium', note: 'Sep 15' },
}

const DEFAULT_CUTOFF = { month: 9, day: 1 } // September 1 (29 states)

interface ParsedDOB { year: number; month: number; day: number }

/** Parse 'YYYY-MM-DD' or a Date into {year, month, day} with no timezone drift. */
function parseDOB(dob: string | Date): ParsedDOB {
  if (dob instanceof Date) {
    return { year: dob.getFullYear(), month: dob.getMonth() + 1, day: dob.getDate() }
  }
  const m = String(dob).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) throw new Error(`Invalid DOB (expected YYYY-MM-DD or Date): ${dob}`)
  return { year: +m[1], month: +m[2], day: +m[3] }
}

export interface GradeEstimateOptions {
  state?: string
  cutoffMonth?: number
  cutoffDay?: number
  asOf?: string | Date
  rolloverMonth?: number
}

export interface GradeEstimate {
  grade: number
  kStartYear: number
  gradYear: number
  schoolYearFall: number
  cutoff: { month: number; day: number }
}

/** Estimate a student's US school grade (K = 0). */
export function estimateSchoolGrade(dob: string | Date, opts: GradeEstimateOptions = {}): GradeEstimate {
  const { year: by, month: bm, day: bd } = parseDOB(dob)

  // Resolve cutoff: explicit override > state table > Sep 1 default.
  const stateRec = opts.state ? STATE_CUTOFFS[opts.state] : null
  const cutoffMonth = opts.cutoffMonth ?? (stateRec ? stateRec.month : DEFAULT_CUTOFF.month)
  const cutoffDay = opts.cutoffDay ?? (stateRec ? stateRec.day : DEFAULT_CUTOFF.day)

  // 1. Which school year are we evaluating? (fall calendar year F)
  const asOf = opts.asOf ? (opts.asOf instanceof Date ? opts.asOf : new Date(opts.asOf + 'T00:00:00')) : new Date()
  const rolloverMonth = opts.rolloverMonth ?? 7
  const asOfMonth = asOf.getMonth() + 1
  const fallYear = asOfMonth >= rolloverMonth ? asOf.getFullYear() : asOf.getFullYear() - 1

  // 2. Born AFTER the cutoff? (born exactly ON the cutoff counts as before)
  const bornAfterCutoff = bm > cutoffMonth || (bm === cutoffMonth && bd > cutoffDay)

  // 3. Fall year the child starts Kindergarten
  const kStartYear = by + 5 + (bornAfterCutoff ? 1 : 0)

  // 4. Grade number (K = 0)
  const grade = fallYear - kStartYear

  return {
    grade,
    kStartYear,
    gradYear: kStartYear + 13,
    schoolYearFall: fallYear,
    cutoff: { month: cutoffMonth, day: cutoffDay },
  }
}

export type HighSchoolGrade = '9' | '10' | '11' | '12'

/**
 * Pre-fill value for the High-School Grade dropdown (options 9–12).
 *
 * Uses the state entry-cutoff table when the registrant's school State is known
 * (defaults to Sep 1 otherwise), then clamps to the 9–12 band — a registrant in
 * the "High School" bracket younger than a freshman defaults to 9, older than a
 * senior defaults to 12. Returns '' when the DOB is missing/unparseable so the
 * caller leaves the field untouched. Always user-editable.
 */
export function inferHighSchoolGrade(
  dob: string,
  state?: string | null,
  asOf?: string | Date,
  opts?: { clampToBand?: boolean }
): HighSchoolGrade | '' {
  if (!dob) return ''
  try {
    const { grade } = estimateSchoolGrade(dob, { state: state ?? undefined, asOf })
    // Default (HS-bracket forms): clamp into 9–12 — the registrant is known to be
    // in high school, so a value just outside the band snaps to the nearest edge.
    // clampToBand:false (forms where the student may be college-aged, e.g. the
    // group-join form whose Grade list runs up to Grad/PhD): return '' when the
    // computed grade is outside 9–12, so the caller does NOT overwrite a manually
    // chosen college grade on a later DOB edit.
    if (opts?.clampToBand === false) {
      if (grade < 9 || grade > 12) return ''
      return String(grade) as HighSchoolGrade
    }
    const clamped = Math.min(12, Math.max(9, grade))
    return String(clamped) as HighSchoolGrade
  } catch {
    return ''
  }
}
