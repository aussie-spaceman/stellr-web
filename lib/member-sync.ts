import type { SupabaseClient } from '@supabase/supabase-js'
import {
  normalizeGender,
  normalizeAgeBracket,
  normalizeEventRole,
  normalizeGrade,
  normalizeTshirt,
  normalizeEmail,
} from '@/lib/member-enums'

export interface MemberUpsertInput {
  email: string
  first_name: string
  last_name: string
  nickname?: string | null
  phone?: string | null
  date_of_birth?: string | null
  gender?: unknown
  grade?: unknown
  t_shirt_size?: unknown
  age_bracket?: unknown
  event_role?: unknown
}

// Upsert a `members` row from participant-shaped data, running the display
// strings through the enum normalisers (see lib/member-enums). Conflicts on
// email so the same person is never duplicated. Returns the member id, or null
// when the email is missing or the upsert fails — callers treat member creation
// as non-fatal (the participant row is still saved either way).
export async function upsertMember(
  db: SupabaseClient,
  input: MemberUpsertInput
): Promise<string | null> {
  const email = normalizeEmail(input.email)
  if (!email) return null

  const { data, error } = await db
    .from('members')
    .upsert(
      {
        email,
        first_name: input.first_name,
        last_name: input.last_name,
        nickname: input.nickname || null,
        phone: input.phone ?? null,
        date_of_birth: input.date_of_birth || null,
        gender: normalizeGender(input.gender),
        grade: normalizeGrade(input.grade),
        tshirt_size: normalizeTshirt(input.t_shirt_size),
        age_bracket: normalizeAgeBracket(input.age_bracket),
        event_role: normalizeEventRole(input.event_role),
        is_active: true,
      },
      { onConflict: 'email', ignoreDuplicates: false }
    )
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[member-sync] Member upsert error (non-fatal):', error)
    return null
  }
  return data?.id ?? null
}
