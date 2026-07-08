export const T_SHIRT_SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL (or larger)']
export const GENDERS = ['Male', 'Female', 'Other']
export const GRADES = ['9', '10', '11', '12', 'College Freshman', 'College Sophomore', 'College Junior', 'College Senior', 'Grad / PhD']
export const HS_GRADES = ['9', '10', '11', '12']
// College bracket year levels — manual selection only (not age-inferred).
export const COLLEGE_GRADES = ['College Freshman', 'College Sophomore', 'College Junior', 'College Senior', 'Grad / PhD']

// Registrant type shown on the public registration form. Maps 1:1 to the three
// member age brackets. High School infers Grade from DOB + school State; College
// is a manual year-level pick; Adult carries no grade.
export type RegistrantType = 'high_school' | 'college' | 'adult'

export function registrantTypeToAgeBracket(t: RegistrantType): 'High School' | 'College' | 'Adult' {
  return t === 'high_school' ? 'High School' : t === 'college' ? 'College' : 'Adult'
}
export const ETHNICITIES = ['Pacific Islander', 'Hispanic', 'White (Caucasian)', 'Black', 'Native American', 'Asian', 'Prefer Not To Say']
export const DIETARY = ['None', 'Dairy / Lactose Free', 'Gluten Free', 'Halal', 'Kosher', 'Vegetarian', 'Vegan', 'Other']
// Emergency contact "Relationship To Participant" — maps to DocuSign tab "MinorRelationship"
export const EMERGENCY_RELATIONSHIPS = ['Parent', 'Legal Guardian', 'Spouse', 'Grandparent', 'Teacher']

export function deriveAgeBracket(dob: string, grade?: string): 'High School' | 'College' | 'Adult' {
  if (!dob) return 'Adult'
  const age = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000))
  if (age < 18 || (grade && HS_GRADES.includes(grade))) return 'High School'
  if (grade?.startsWith('College') || grade === 'Grad / PhD') return 'College'
  return 'Adult'
}
