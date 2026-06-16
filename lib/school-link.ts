import type { SupabaseClient } from '@supabase/supabase-js'
import { logActivity } from '@/lib/activity-log'

export interface SchoolDetails {
  /** When the registrant picked an existing school from search, its id is
   *  authoritative — we link to it directly and never resolve/create by name
   *  (which is what spawned duplicate "Alta High School" rows). */
  id?: string | null
  name: string | null | undefined
  address_street?: string | null
  address_city?: string | null
  address_state?: string | null
  address_zip?: string | null
}

// Collapse internal whitespace and trim so "Alta  High School " and
// "Alta High School" resolve to the same row.
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

// Resolve a school selection to a schools.id, creating the school row if it
// doesn't exist yet. When the caller supplies an explicit `id` (the registrant
// chose an existing school), that id is used verbatim — no name match, no
// create. Otherwise the name is matched case-insensitively on its normalized
// form so registrations don't spawn near-duplicate schools. Returns null when
// nothing was given or the lookup/insert fails (callers treat school linking as
// non-fatal — the registration must never fail because of it).
export async function resolveSchoolId(
  db: SupabaseClient,
  school: SchoolDetails
): Promise<string | null> {
  if (school.id) return school.id

  const name = school.name ? normalizeName(school.name) : ''
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
      // New schools must be active so they show up in the registration search
      // immediately (the search filters on is_active). Legacy rows created
      // before this default are repaired by the schools-hardening migration.
      is_active: true,
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
    return
  }

  // Audit trail — one entry per newly-linked member.
  const { data: school } = await db.from('schools').select('name').eq('id', schoolId).maybeSingle()
  for (const member_id of toLink) {
    await logActivity({
      memberId: member_id,
      category: 'school',
      action: 'school_linked',
      summary: `Linked to school ${school?.name ?? ''}`.trim(),
      metadata: { schoolId, schoolName: school?.name ?? null },
      actorType: 'system',
    }, db)
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

// Like linkMembersToSchoolByName, but also returns the resolved school's id and
// canonical state. The individual registration route needs the state to fill
// the DocuSign "State of Residence" tab — and the authoritative value is the
// stored school's state, not the (usually empty) address fields the form sends
// for an existing-school selection. Non-fatal: returns null on any failure.
export async function resolveAndLinkSchool(
  db: SupabaseClient,
  memberIds: (string | null | undefined)[],
  school: SchoolDetails
): Promise<{ id: string; state: string | null } | null> {
  try {
    const schoolId = await resolveSchoolId(db, school)
    if (!schoolId) return null
    let state: string | null = school.address_state?.trim() || null
    const { data } = await db.from('schools').select('state').eq('id', schoolId).maybeSingle()
    if (data?.state) state = data.state
    await linkMembersToSchool(db, memberIds, schoolId)
    return { id: schoolId, state }
  } catch (e) {
    console.error('[school-link] resolveAndLinkSchool failed (non-fatal):', e)
    return null
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
