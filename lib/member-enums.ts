// Normalises the human-readable values the registration forms submit
// (e.g. "Adult", "Female", "School Student") into the lowercase snake_case
// values required by the `members` table's Postgres enum columns
// (gender_type, age_bracket_type, event_role_type).
//
// Participants are stored with the display strings (plain text columns), but the
// members table is strongly typed — feeding it a display string raises
// `22P02 invalid input value for enum …` and, because the upsert is batched,
// silently drops every member in the registration. Always run member-bound
// gender / age_bracket / event_role through these helpers first.

export const VALID_GENDERS = ['male', 'female', 'other', 'prefer_not_to_say'] as const
export const VALID_AGE_BRACKETS = ['adult', 'high_school', 'college'] as const
// 'adult' and 'school_student_manager' require migration 016 to exist in the enum.
export const VALID_EVENT_ROLES = [
  'teacher', 'school_student', 'school_student_manager', 'mentor', 'subscriber', 'parent', 'adult',
] as const
export const VALID_GRADES = [
  'grade_9', 'grade_10', 'grade_11', 'grade_12',
  'college_freshman', 'college_sophomore', 'college_junior', 'college_senior', 'grad_phd',
] as const
// '3XL (or larger)' requires migration 016 to exist in the enum.
export const VALID_TSHIRT_SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL (or larger)'] as const

function canon(v: unknown): string {
  return (v ?? '').toString().trim().toLowerCase().replace(/[\s/-]+/g, '_')
}

// Gender → enum, or null when unrecognised (column is nullable).
export function normalizeGender(v: unknown): string | null {
  const c = canon(v)
  return (VALID_GENDERS as readonly string[]).includes(c) ? c : null
}

// Age bracket → enum. Defaults to 'adult' when unrecognised.
export function normalizeAgeBracket(v: unknown): string {
  const c = canon(v)
  return (VALID_AGE_BRACKETS as readonly string[]).includes(c) ? c : 'adult'
}

// Event role → enum. Defaults to 'subscriber' (the generic member role) when
// unrecognised. ("School Student Manager" / "Adult" canonicalise to valid values.)
export function normalizeEventRole(v: unknown): string {
  const c = canon(v)
  return (VALID_EVENT_ROLES as readonly string[]).includes(c) ? c : 'subscriber'
}

// Grade → enum, or null when unrecognised (column is nullable). Bare numerics
// ("9".."12") gain the "grade_" prefix; "College Freshman"/"Grad / PhD" canonicalise.
export function normalizeGrade(v: unknown): string | null {
  if (v == null || v === '') return null
  let c = canon(v)
  if (/^\d+$/.test(c)) c = `grade_${c}`
  return (VALID_GRADES as readonly string[]).includes(c) ? c : null
}

// T-shirt size → enum, or null when unrecognised (e.g. the form's "3XL (or larger)",
// which has no enum value). Sizes are stored verbatim, not canonicalised.
export function normalizeTshirt(v: unknown): string | null {
  const s = (v ?? '').toString().trim()
  return (VALID_TSHIRT_SIZES as readonly string[]).includes(s) ? s : null
}

// ── Reverse maps (enum → registration-form display string) ────────────────────
// Used to pre-fill the registration forms from a `members` row, whose columns
// are enums while the form <select>s use display labels. Return undefined when
// there's no corresponding form option (e.g. gender 'prefer_not_to_say').

export function denormalizeGender(v: unknown): string | undefined {
  return { male: 'Male', female: 'Female', other: 'Other' }[canon(v)]
}

export function denormalizeGrade(v: unknown): string | undefined {
  const c = canon(v)
  const m = c.match(/^grade_(9|10|11|12)$/)
  if (m) return m[1]
  return {
    college_freshman: 'College Freshman',
    college_sophomore: 'College Sophomore',
    college_junior: 'College Junior',
    college_senior: 'College Senior',
    grad_phd: 'Grad / PhD',
  }[c]
}

// T-shirt sizes are stored verbatim, so the display value is the stored value.
export function denormalizeTshirt(v: unknown): string | undefined {
  const s = (v ?? '').toString().trim()
  return s.length > 0 ? s : undefined
}
