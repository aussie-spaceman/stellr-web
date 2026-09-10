/**
 * grade-band.ts
 * -----------------------------------------------------------------------------
 * The grade range an event or campaign is open to, and every piece of wording
 * derived from it — the eligibility sentence, the metadata audience, the card
 * pill, and the options in the registration Grade dropdown.
 *
 * `gradeLevel` ("Middle School" / "High School" / "Both") is the coarse bracket
 * every document has carried since launch. It drives the /events filter and the
 * HubSpot demographic, and it cannot express a band that straddles the two
 * unevenly: Colorado 2027 opened to grades 7–12, which is neither "High School"
 * (9–12) nor "Both" (6–12).
 *
 * So a document may also carry an explicit `gradeMin`/`gradeMax`. When it does,
 * that IS the band and the wording is generated from it. When it doesn't — every
 * other event — the band is derived from `gradeLevel` and the copy comes out
 * byte-identical to what it was before this file existed.
 *
 * Copy lived in two forked copies before this (the event page and
 * lib/campaign-content.ts), which is how a middle-school event nearly inherited
 * the high-school range twice. One source now.
 */

/** Bounds of the K-12 range. A band is clamped into this before anything reads it. */
const FLOOR = 1
const CEILING = 12

/** Where high school starts. Below this a grade is middle school or younger. */
const HS_START = 9

export interface GradeBandInput {
  gradeLevel?: string | null
  gradeMin?: number | null
  gradeMax?: number | null
}

export interface GradeBand {
  /** Lowest eligible grade. */
  min: number
  /** Highest eligible grade. */
  max: number
  /** Pill text — "High School", or "Grades 7–12" when the band is an override. */
  label: string
  /** Full audience clause: "middle and high school students (grades 7–12)". */
  audience: string
  /** Bare noun for metadata: "high school", "middle and high school". */
  audienceShort: string
  /** True when the document set an explicit band rather than inheriting one. */
  isOverride: boolean
}

/** The band each `gradeLevel` implies when no explicit override is set. */
function defaultBand(gradeLevel?: string | null): { min: number; max: number } {
  switch (gradeLevel?.trim()) {
    case 'Middle School':
      return { min: 6, max: 8 }
    case 'Both':
      return { min: 6, max: 12 }
    // "High School", and anything unset or unrecognised, keeps the historic
    // default — the same fallback the two forked copies of this used.
    default:
      return { min: 9, max: 12 }
  }
}

function clamp(n: number): number {
  return Math.min(CEILING, Math.max(FLOOR, Math.round(n)))
}

/**
 * Resolve a document's grade band. An override counts only when BOTH bounds are
 * present and ordered — a half-filled override in the Studio falls back to the
 * `gradeLevel` default rather than inventing a range from one number.
 */
export function gradeBand(input: GradeBandInput): GradeBand {
  const { gradeLevel, gradeMin, gradeMax } = input
  const hasOverride =
    typeof gradeMin === 'number' &&
    typeof gradeMax === 'number' &&
    Number.isFinite(gradeMin) &&
    Number.isFinite(gradeMax) &&
    clamp(gradeMin) <= clamp(gradeMax)

  const { min, max } = hasOverride
    ? { min: clamp(gradeMin as number), max: clamp(gradeMax as number) }
    : defaultBand(gradeLevel)

  const audienceShort =
    min >= HS_START ? 'high school' : max < HS_START ? 'middle school' : 'middle and high school'

  return {
    min,
    max,
    // An override names the grades outright — "High School" would be a lie on a
    // 7–12 event, and "Both" tells a teacher nothing about where it starts.
    label: hasOverride ? `Grades ${min}–${max}` : (gradeLevel?.trim() || 'High School'),
    audience: `${audienceShort} students (grades ${min}–${max})`,
    audienceShort,
    isOverride: hasOverride,
  }
}

/**
 * Grade options for the registration dropdown, oldest-first as the field reads
 * ("Grade 7" … "Grade 12"). Returned as strings because that is what the form,
 * the payload and the `participants.grade` column all hold.
 */
export function gradeOptions(band: Pick<GradeBand, 'min' | 'max'>): string[] {
  const out: string[] = []
  for (let g = band.min; g <= band.max; g++) out.push(String(g))
  return out
}

/**
 * Does a document belong under the /events "Middle School" / "High School"
 * filter chip?
 *
 * Tested against the BAND, not the bracket string. Exact string equality used to
 * decide this, which hid every "Both" document from both chips — the one filter
 * combination where a teacher looking for a middle-school option would most want
 * to see it. A band overlapping the chip's range matches it, so a grades 7–12
 * event appears under both.
 */
export function matchesGradeFilter(input: GradeBandInput, filter: string): boolean {
  if (!filter) return true
  const { min, max } = gradeBand(input)
  if (filter === 'Middle School') return min < HS_START
  if (filter === 'High School') return max >= HS_START
  return true // an unrecognised chip filters nothing out
}
