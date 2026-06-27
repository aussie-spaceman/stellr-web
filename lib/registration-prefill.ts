import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, type CommunityMember } from '@/lib/community'
import { denormalizeGender, denormalizeGrade, denormalizeTshirt } from '@/lib/member-enums'

// Update #2 — "recognize log in for registration".
// When a signed-in member starts a registration, pre-fill what we already know
// so we don't ask for it again. The richest source is the member's most recent
// `participants` row (it stores the form's display-string values + event-only
// fields like emergency contact); we fall back to the `members` row for the
// basics. `email` is always the authenticated session email and is locked on
// the form (Option A — a logged-in user can't register under another address).

export interface RegistrationPrefill {
  memberId: string
  /** Authenticated session email — authoritative, rendered read-only. */
  email: string
  /** members.age_bracket enum: 'adult' | 'high_school' | 'college'. Drives
   *  whether the individual form shows student-only fields (grade, etc.). */
  age_bracket?: string
  /** members.event_role enum: 'teacher' | 'participant' | 'mentor' | … */
  event_role?: string
  first_name?: string
  last_name?: string
  nickname?: string
  phone?: string
  date_of_birth?: string
  grade?: string
  gender?: string
  t_shirt_size?: string
  ethnicity?: string[]
  dietary_requirements?: string[]
  health_conditions?: string
  emergency_contact_first_name?: string
  emergency_contact_last_name?: string
  emergency_contact_email?: string
  emergency_contact_phone?: string
  emergency_contact_relationship?: string
  school_name?: string
  /** The member's current school (member_schools join), ready to seed the
   *  SchoolSearchInput so they don't re-pick it. */
  school?: { id: string; name: string }
}

/**
 * Resolve a prefill payload for the currently signed-in member, or null when
 * unauthenticated / no member record. Safe to call from public (www)
 * registration pages — returns null (and the form behaves exactly as before)
 * whenever the Clerk session doesn't resolve.
 */
export async function getRegistrationPrefill(
  member?: CommunityMember | null
): Promise<RegistrationPrefill | null> {
  const m = member ?? (await getCurrentMember())
  if (!m || !m.email) return null

  const db = supabaseServer()

  // Two sources, in priority order:
  //   1. the member's most recent participants row — richest (display-string
  //      values + event-only fields like emergency contact), but only exists
  //      once they've registered for something before;
  //   2. the members row — always exists for a signed-in member; columns are
  //      enums, so denormalize them back to the form's display labels.
  const [{ data: last }, { data: mem }, { data: schoolLink }] = await Promise.all([
    db
      .from('participants')
      .select(
        `first_name, last_name, nickname, phone, date_of_birth, grade, gender,
         t_shirt_size, ethnicity, dietary_requirements, health_conditions,
         school_name, emergency_contact_first_name, emergency_contact_last_name,
         emergency_contact_email, emergency_contact_phone, emergency_contact_relationship`
      )
      .eq('member_id', m.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from('members')
      .select(
        `first_name, last_name, nickname, phone, date_of_birth, grade, gender, tshirt_size,
         age_bracket, event_role, health_conditions,
         ec_first_name, ec_last_name, ec_email, ec_phone, ec_relationship,
         member_ethnicities(ethnicity_options!member_ethnicities_ethnicity_option_id_fkey(name)),
         member_allergies(allergy_options!member_allergies_allergy_option_id_fkey(name))`
      )
      .eq('id', m.id)
      .maybeSingle(),
    // Current school via the member_schools join (school isn't a member column).
    db
      .from('member_schools')
      .select('school_id, schools(name)')
      .eq('member_id', m.id)
      .eq('is_current', true)
      .limit(1)
      .maybeSingle(),
  ])

  const p = (last ?? {}) as Record<string, unknown>
  const mr = (mem ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined)
  const arr = (v: unknown) => (Array.isArray(v) && v.length > 0 ? (v as string[]) : undefined)
  // Option names from the member_ethnicities/member_allergies joins ARE the
  // form's display strings (Supabase returns each relation as object|array).
  const joinNames = (rows: unknown, rel: string): string[] | undefined => {
    if (!Array.isArray(rows)) return undefined
    const names = rows
      .map((row) => {
        const r = (row as Record<string, unknown>)[rel]
        return (Array.isArray(r) ? r[0] : (r as { name?: string } | null))?.name
      })
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
    return names.length > 0 ? names : undefined
  }

  // Resolve the joined school name (Supabase returns the relation as object|array).
  const sl = (schoolLink ?? null) as { school_id?: string; schools?: { name?: string } | { name?: string }[] } | null
  const schoolRel = Array.isArray(sl?.schools) ? sl?.schools[0] : sl?.schools
  const schoolName = str(schoolRel?.name) ?? str(p.school_name)
  const school = sl?.school_id && schoolName ? { id: sl.school_id, name: schoolName } : undefined

  return {
    memberId: m.id,
    email: m.email,
    age_bracket: str(mr.age_bracket),
    event_role: str(mr.event_role),
    first_name: str(p.first_name) ?? str(mr.first_name) ?? m.first_name ?? undefined,
    last_name: str(p.last_name) ?? str(mr.last_name) ?? m.last_name ?? undefined,
    nickname: str(p.nickname) ?? str(mr.nickname),
    phone: str(p.phone) ?? str(mr.phone),
    date_of_birth: str(p.date_of_birth) ?? str(mr.date_of_birth),
    grade: str(p.grade) ?? denormalizeGrade(mr.grade),
    gender: str(p.gender) ?? denormalizeGender(mr.gender),
    t_shirt_size: str(p.t_shirt_size) ?? denormalizeTshirt(mr.tshirt_size),
    ethnicity: arr(p.ethnicity) ?? joinNames(mr.member_ethnicities, 'ethnicity_options'),
    dietary_requirements: arr(p.dietary_requirements) ?? joinNames(mr.member_allergies, 'allergy_options'),
    health_conditions: str(p.health_conditions) ?? str(mr.health_conditions),
    emergency_contact_first_name: str(p.emergency_contact_first_name) ?? str(mr.ec_first_name),
    emergency_contact_last_name: str(p.emergency_contact_last_name) ?? str(mr.ec_last_name),
    emergency_contact_email: str(p.emergency_contact_email) ?? str(mr.ec_email),
    emergency_contact_phone: str(p.emergency_contact_phone) ?? str(mr.ec_phone),
    emergency_contact_relationship: str(p.emergency_contact_relationship) ?? str(mr.ec_relationship),
    school_name: schoolName,
    school,
  }
}
