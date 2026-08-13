import type { SupabaseClient } from '@supabase/supabase-js'
import {
  normalizeGender,
  normalizeAgeBracket,
  normalizeEventRole,
  normalizeGrade,
  normalizeTshirt,
  normalizeEmail,
} from '@/lib/member-enums'
import { syncMemberClassificationRole } from '@/lib/member-roles'

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
  health_conditions?: string | null
  ec_first_name?: string | null
  ec_last_name?: string | null
  ec_email?: string | null
  ec_phone?: string | null
  ec_relationship?: string | null
}

// Was this field actually filled in? Blank strings, whitespace, null and
// undefined all mean "not submitted" — they must never overwrite what's already
// on file for an existing member.
function submitted(v: unknown): boolean {
  if (v == null) return false
  return String(v).trim().length > 0
}

// Drop keys whose value is undefined so a PATCH only touches the columns the
// caller actually supplied.
function compact<T extends Record<string, unknown>>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>
}

// Fill every blank field in an outgoing members payload from the row already on
// file, mutating the payload in place.
//
// For callers that must use a batched `upsert(..., { onConflict: 'email' })` —
// ON CONFLICT DO UPDATE overwrites every column in the payload, so a blank
// optional field wipes what the member already had. Pre-loading the stored rows
// and running them through this gives the batch the same merge guarantee
// upsertMember gives the single-person paths, without giving up the one
// round-trip. `email` is the match key and is never overwritten.
export function fillBlanksFromStored(
  payload: Record<string, unknown>,
  stored: Record<string, unknown>,
): void {
  for (const [column, storedValue] of Object.entries(stored)) {
    if (column === 'email' || storedValue == null) continue
    if (!submitted(payload[column])) payload[column] = storedValue
  }
}

// Create or update a `members` row from participant-shaped data, running the
// display strings through the enum normalisers (see lib/member-enums).
//
// Email is the cross-reference key: anyone added to a group — via the join link,
// the roster spreadsheet, or an organiser adding them in the portal — is matched
// against the existing membership database by their (normalised) email. A match
// UPDATES that member from what was just submitted rather than creating a second
// record; only then is a new member created.
//
// The update is a merge, not a replace: a field left blank on the form or in the
// sheet keeps whatever is already on file. Overwriting with blanks would let a
// half-filled sheet row wipe a member's phone, emergency contact or DOB.
//
// Returns the member id, or null when the email is missing or the write fails —
// callers treat member creation as non-fatal (the participant row is saved
// either way).
export async function upsertMember(
  db: SupabaseClient,
  input: MemberUpsertInput
): Promise<string | null> {
  const email = normalizeEmail(input.email)
  if (!email) return null

  const eventRole = normalizeEventRole(input.event_role)

  // Cross-reference against the existing membership database by email.
  const { data: existing, error: lookupError } = await db
    .from('members')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (lookupError) {
    console.error('[member-sync] Member lookup error (non-fatal):', lookupError)
    return null
  }

  let memberId: string | null = null
  // The role written to members/member_roles: an existing member keeps theirs
  // unless a real role was submitted, so a blank/unknown value can't demote a
  // teacher to the 'subscriber' fallback normalizeEventRole falls back to.
  let effectiveRole = eventRole

  if (existing) {
    const patch = compact({
      first_name: submitted(input.first_name) ? input.first_name : undefined,
      last_name: submitted(input.last_name) ? input.last_name : undefined,
      nickname: submitted(input.nickname) ? input.nickname : undefined,
      phone: submitted(input.phone) ? input.phone : undefined,
      date_of_birth: submitted(input.date_of_birth) ? input.date_of_birth : undefined,
      gender: normalizeGender(input.gender) ?? undefined,
      grade: normalizeGrade(input.grade) ?? undefined,
      tshirt_size: normalizeTshirt(input.t_shirt_size) ?? undefined,
      age_bracket: submitted(input.age_bracket) ? normalizeAgeBracket(input.age_bracket) : undefined,
      event_role: submitted(input.event_role) ? eventRole : undefined,
      health_conditions: submitted(input.health_conditions) ? input.health_conditions : undefined,
      ec_first_name: submitted(input.ec_first_name) ? input.ec_first_name : undefined,
      ec_last_name: submitted(input.ec_last_name) ? input.ec_last_name : undefined,
      ec_email: submitted(input.ec_email) ? normalizeEmail(input.ec_email) : undefined,
      ec_phone: submitted(input.ec_phone) ? input.ec_phone : undefined,
      ec_relationship: submitted(input.ec_relationship) ? input.ec_relationship : undefined,
      is_active: true,
    })

    if (!submitted(input.event_role)) {
      const { data: current } = await db
        .from('members').select('event_role').eq('id', existing.id).maybeSingle()
      if (current?.event_role) effectiveRole = current.event_role as string
    }

    const { error: updateError } = await db.from('members').update(patch).eq('id', existing.id)
    if (updateError) {
      console.error('[member-sync] Member update error (non-fatal):', updateError)
      return null
    }
    memberId = existing.id
  } else {
    const { data, error } = await db
      .from('members')
      .insert({
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
        event_role: eventRole,
        is_active: true,
        health_conditions: input.health_conditions || null,
        ec_first_name: input.ec_first_name || null,
        ec_last_name: input.ec_last_name || null,
        ec_email: input.ec_email ? normalizeEmail(input.ec_email) : null,
        ec_phone: input.ec_phone || null,
        ec_relationship: input.ec_relationship || null,
      })
      .select('id')
      .maybeSingle()

    if (error) {
      console.error('[member-sync] Member insert error (non-fatal):', error)
      return null
    }
    memberId = data?.id ?? null
  }

  // Keep the unified member_roles table current with the registration classification.
  if (memberId) await syncMemberClassificationRole(db, memberId, effectiveRole)

  return memberId
}
