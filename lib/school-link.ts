import type { SupabaseClient } from '@supabase/supabase-js'

export interface SchoolDetails {
  name: string | null | undefined
  address_street?: string | null
  address_city?: string | null
  address_state?: string | null
  address_zip?: string | null
}

// Resolve a free-text school name to a schools.id, creating the school row if
// it doesn't exist yet. Matching is case-insensitive on the trimmed name so
// registrations don't spawn near-duplicate schools. Returns null when no name
// was given or the lookup/insert fails (callers treat school linking as
// non-fatal — the registration must never fail because of it).
export async function resolveSchoolId(
  db: SupabaseClient,
  school: SchoolDetails
): Promise<string | null> {
  const name = school.name?.trim()
  if (!name) return null

  const { data: existing, error: lookupError } = await db
    .from('schools')
    .select('id')
    .ilike('name', name)
    .limit(1)
    .maybeSingle()
  if (lookupError) {
    console.error('[school-link] School lookup error:', lookupError)
    return null
  }
  if (existing) return existing.id

  const { data: created, error: insertError } = await db
    .from('schools')
    .insert({
      name,
      address_line1: school.address_street?.trim() || null,
      city: school.address_city?.trim() || null,
      state: school.address_state?.trim() || null,
      postcode: school.address_zip?.trim() || null,
    })
    .select('id')
    .single()
  if (insertError) {
    console.error('[school-link] School insert error:', insertError)
    return null
  }
  return created.id
}

// Link members to a school via member_schools. Members that already have a
// current school link are left untouched — a registration must not silently
// move someone who is already linked elsewhere.
export async function linkMembersToSchool(
  db: SupabaseClient,
  memberIds: (string | null | undefined)[],
  schoolId: string
): Promise<void> {
  const ids = [...new Set(memberIds.filter((id): id is string => Boolean(id)))]
  if (ids.length === 0) return

  const { data: existingLinks, error: linksError } = await db
    .from('member_schools')
    .select('member_id')
    .in('member_id', ids)
    .eq('is_current', true)
  if (linksError) {
    console.error('[school-link] member_schools lookup error:', linksError)
    return
  }

  const alreadyLinked = new Set((existingLinks ?? []).map((l) => l.member_id))
  const toLink = ids.filter((id) => !alreadyLinked.has(id))
  if (toLink.length === 0) return

  const today = new Date().toISOString().split('T')[0]
  const { error: upsertError } = await db.from('member_schools').upsert(
    toLink.map((member_id) => ({
      member_id,
      school_id: schoolId,
      is_current: true,
      started_at: today,
    })),
    { onConflict: 'member_id,school_id' }
  )
  if (upsertError) {
    console.error('[school-link] member_schools upsert error:', upsertError)
  }
}

// Convenience wrapper used by the registration routes: resolve the school by
// name (creating it if needed) and link every supplied member to it.
export async function linkMembersToSchoolByName(
  db: SupabaseClient,
  memberIds: (string | null | undefined)[],
  school: SchoolDetails
): Promise<void> {
  try {
    const schoolId = await resolveSchoolId(db, school)
    if (!schoolId) return
    await linkMembersToSchool(db, memberIds, schoolId)
  } catch (e) {
    console.error('[school-link] Linking failed (non-fatal):', e)
  }
}

// Convenience wrapper for the team/portal paths that don't carry the school
// inline: look up the group registration's school (free text + address fields)
// and link every supplied member to it. Non-fatal.
export async function linkMembersToRegistrationSchool(
  db: SupabaseClient,
  registrationId: string,
  memberIds: (string | null | undefined)[]
): Promise<void> {
  try {
    if (memberIds.filter(Boolean).length === 0) return
    const { data: reg, error } = await db
      .from('registrations')
      .select('school_name, school_address_street, school_address_city, school_address_state, school_address_zip')
      .eq('id', registrationId)
      .maybeSingle()
    if (error || !reg) return
    await linkMembersToSchoolByName(db, memberIds, {
      name: reg.school_name,
      address_street: reg.school_address_street,
      address_city: reg.school_address_city,
      address_state: reg.school_address_state,
      address_zip: reg.school_address_zip,
    })
  } catch (e) {
    console.error('[school-link] Registration-school linking failed (non-fatal):', e)
  }
}
