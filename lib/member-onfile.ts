import type { SupabaseClient } from '@supabase/supabase-js'
import { denormalizeGender, denormalizeGrade, denormalizeTshirt } from '@/lib/member-enums'

export interface OnFileParticipant {
  memberId: string
  first_name: string
  last_name: string
  nickname: string | null
  email: string
  phone: string | null
  date_of_birth: string | null
  grade: string | null
  gender: string | null
  t_shirt_size: string | null
  ethnicity: string[]
  dietary_requirements: string[]
  health_conditions: string | null
  emergency_contact_first_name: string | null
  emergency_contact_last_name: string | null
  emergency_contact_email: string | null
  emergency_contact_phone: string | null
  emergency_contact_relationship: string | null
  event_role: string | null
  age_bracket: string | null
}

// Resolve a Stellr Member ID (a participant's membership_id) to the linked
// member's on-file profile, shaped like a registration participant payload. Used
// when an organiser links an existing member during group registration: we build
// their participant row from this record instead of re-collecting, and never
// overwrite the member. Mirrors the source priority in lib/registration-prefill
// (richest = latest participant row; fall back to the members row, denormalising
// its enum columns back to display strings).
export async function getMemberOnFileByMembershipId(
  db: SupabaseClient,
  membershipId: string,
): Promise<OnFileParticipant | null> {
  const id = membershipId.trim()
  if (!id) return null

  // The id may be the member's canonical id (members.membership_id, migration 036)
  // or a legacy per-event participant id — resolve either to the member.
  let memberId: string | null = null
  const { data: canonical, error: canonErr } = await db
    .from('members')
    .select('id')
    .eq('membership_id', id)
    .maybeSingle()
  if (!canonErr && canonical) memberId = canonical.id as string
  if (!memberId) {
    const { data: part } = await db
      .from('participants')
      .select('member_id')
      .eq('membership_id', id)
      .maybeSingle()
    memberId = (part?.member_id as string | null) ?? null
  }
  if (!memberId) return null

  const [{ data: mem }, { data: last }] = await Promise.all([
    db
      .from('members')
      .select(
        `first_name, last_name, nickname, email, phone, date_of_birth, grade, gender, tshirt_size,
         age_bracket, event_role, health_conditions,
         ec_first_name, ec_last_name, ec_email, ec_phone, ec_relationship,
         member_ethnicities(ethnicity_options!member_ethnicities_ethnicity_option_id_fkey(name)),
         member_allergies(allergy_options!member_allergies_allergy_option_id_fkey(name))`
      )
      .eq('id', memberId)
      .maybeSingle(),
    db
      .from('participants')
      .select(
        `first_name, last_name, nickname, phone, date_of_birth, grade, gender, t_shirt_size, ethnicity,
         dietary_requirements, health_conditions, email,
         emergency_contact_first_name, emergency_contact_last_name, emergency_contact_email,
         emergency_contact_phone, emergency_contact_relationship`
      )
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (!mem) return null

  const p = (last ?? {}) as Record<string, unknown>
  const m = mem as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null)
  const arr = (v: unknown) => (Array.isArray(v) && v.length > 0 ? (v as string[]) : undefined)
  const joinNames = (rows: unknown, rel: string): string[] => {
    if (!Array.isArray(rows)) return []
    return rows
      .map((row) => {
        const r = (row as Record<string, unknown>)[rel]
        return (Array.isArray(r) ? r[0] : (r as { name?: string } | null))?.name
      })
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
  }

  return {
    memberId,
    email: str(p.email) ?? str(m.email) ?? '',
    first_name: str(p.first_name) ?? str(m.first_name) ?? '',
    last_name: str(p.last_name) ?? str(m.last_name) ?? '',
    nickname: str(p.nickname) ?? str(m.nickname),
    phone: str(p.phone) ?? str(m.phone),
    date_of_birth: str(p.date_of_birth) ?? str(m.date_of_birth),
    grade: str(p.grade) ?? denormalizeGrade(m.grade) ?? null,
    gender: str(p.gender) ?? denormalizeGender(m.gender) ?? null,
    t_shirt_size: str(p.t_shirt_size) ?? denormalizeTshirt(m.tshirt_size) ?? null,
    ethnicity: arr(p.ethnicity) ?? joinNames(m.member_ethnicities, 'ethnicity_options'),
    dietary_requirements: arr(p.dietary_requirements) ?? joinNames(m.member_allergies, 'allergy_options'),
    health_conditions: str(p.health_conditions) ?? str(m.health_conditions),
    emergency_contact_first_name: str(p.emergency_contact_first_name) ?? str(m.ec_first_name),
    emergency_contact_last_name: str(p.emergency_contact_last_name) ?? str(m.ec_last_name),
    emergency_contact_email: str(p.emergency_contact_email) ?? str(m.ec_email),
    emergency_contact_phone: str(p.emergency_contact_phone) ?? str(m.ec_phone),
    emergency_contact_relationship: str(p.emergency_contact_relationship) ?? str(m.ec_relationship),
    event_role: str(m.event_role),
    age_bracket: str(m.age_bracket),
  }
}
