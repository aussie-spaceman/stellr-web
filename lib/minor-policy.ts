/**
 * Stellr's minor definition (Privacy Policy §2, Terms §4.1; Minors Agreement
 * V2.3): under the age of majority in the person's home state, OR still in
 * high school, OR a ward.
 *
 * What the data can and cannot say (2 Oct 2026):
 *   - No home-state field exists. The school's state stands in for it, as the
 *     privacy runbook (Part C) already does for NY/CO media defaults.
 *   - No ward field exists, so wards are caught only by the other two rules.
 *   - A student with no date of birth is treated as a minor: the cautious
 *     reading, and the one lib/no-ads.ts already takes.
 * Age itself always comes from lib/age.ts. Imports nothing else, so the
 * credential routes can use it without lib/locations' Sanity client (moved
 * here from lib/survey/minor, 9 Oct 2026).
 */
import { ageOfMajority, ageOn, appToday, isValidDob, onDate } from '@/lib/age'

const HIGH_SCHOOL_GRADES = new Set(['grade_6', 'grade_7', 'grade_8', 'grade_9', 'grade_10', 'grade_11', 'grade_12'])

/** Grade as stored on members (grade_9) or free text on participants ("9", "9th", "Grade 9"). */
export function isSchoolGrade(grade: string | null | undefined): boolean {
  if (!grade) return false
  const g = grade.trim().toLowerCase()
  if (HIGH_SCHOOL_GRADES.has(g)) return true
  const m = /^(?:grade[\s_-]*)?(\d{1,2})(?:st|nd|rd|th)?(?:\s*grade)?$/.exec(g)
  return !!m && Number(m[1]) >= 1 && Number(m[1]) <= 12
}

export interface MinorFacts {
  dateOfBirth: string | null | undefined
  /** Home state, or the best stand-in (school state). A code or a full name. */
  state: string | null | undefined
  ageBracket?: string | null
  grade?: string | null
  isWard?: boolean | null
  /** Students with no DOB are presumed minors; adults (mentors, teachers, parents) are not. */
  presumeMinorIfUnknown?: boolean
}

export function isMinorPerPolicy(f: MinorFacts, on: Date | string = appToday()): boolean {
  if (f.isWard) return true
  if (f.ageBracket === 'high_school' || isSchoolGrade(f.grade)) return true
  if (!isValidDob(f.dateOfBirth)) return f.presumeMinorIfUnknown === true
  return ageOn(f.dateOfBirth, onDate(on)) < ageOfMajority(f.state)
}
