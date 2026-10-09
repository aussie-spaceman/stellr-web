/**
 * Stellr's minor definition now lives in lib/minor-policy.ts (shared with
 * credentials); it is re-exported here so survey code keeps one import.
 * Age itself always comes from lib/age.ts.
 */
import { ageOfMajority as ageOfMajorityByState, ageOn, appToday, isValidDob, onDate } from '@/lib/age'
import { normaliseState } from '@/lib/locations'

export { isSchoolGrade, isMinorPerPolicy, type MinorFacts } from '@/lib/minor-policy'

/** Age of majority by state (lib/age.ts, V2.3): accepts a code or any spelling normaliseState knows. */
export function ageOfMajority(state: string | null | undefined): number {
  return ageOfMajorityByState(state ? normaliseState(state) ?? state : null)
}

/** Age in whole years, or null when the DOB is unusable. */
export function ageIfKnown(dateOfBirth: string | null | undefined, on: Date | string = appToday()): number | null {
  return isValidDob(dateOfBirth) ? ageOn(dateOfBirth, onDate(on)) : null
}
