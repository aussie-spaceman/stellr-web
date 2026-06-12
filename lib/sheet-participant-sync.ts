import type { SupabaseClient } from '@supabase/supabase-js'
import { readSheetParticipants } from '@/lib/google-sheets'
import { upsertMember } from '@/lib/member-sync'
import { linkMembersToRegistrationSchool } from '@/lib/school-link'
import { recordEventParticipationForRegistration } from '@/lib/event-participation-sync'
import { dispatchAgreement } from '@/lib/docusign-agreements'
import { isMinor } from '@/lib/docusign'

export interface SheetSyncRegistration {
  id: string
  spreadsheet_id: string
  school_name: string | null
  event_slug: string
  event_title: string
  school_address_state?: string | null
}

export interface SheetSyncResult {
  created: number
  updated: number
  syncedMemberIds: string[]
}

// Map the sheet's "Type" column to the members/participants enum role + bracket.
// Minors are always students (sheet people are never organisers).
function roleFromType(type: string, dateOfBirth: string | null): { eventRole: string; ageBracket: string } {
  const t = (type || '').trim().toLowerCase()
  const minor = dateOfBirth ? isMinor(dateOfBirth) : false
  let role =
    t === 'adult' ? 'adult' :
    t === 'mentor' ? 'mentor' :
    t === 'teacher' ? 'teacher' :
    'school_student'
  if (minor) role = 'school_student'
  return { eventRole: role, ageBracket: role === 'school_student' ? 'high_school' : 'adult' }
}

// Reads the linked Google Sheet and upserts members + participants, then issues
// the correct DocuSign agreement for anyone who doesn't already have an envelope
// — so a person added via the sheet gets exactly the same paperwork flow as one
// added through the join link. Shared by the manual "Sync From Sheet" button and
// the Google-Drive change webhook so the two never drift. Non-fatal throughout.
export async function syncParticipantsFromSheet(
  db: SupabaseClient,
  registration: SheetSyncRegistration,
): Promise<SheetSyncResult> {
  const sheetRows = await readSheetParticipants(registration.spreadsheet_id)

  let created = 0
  let updated = 0
  const syncedMemberIds: string[] = []

  for (const row of sheetRows) {
    if (!row.first_name && !row.email) continue

    const { data: existing } = await db
      .from('participants')
      .select('id')
      .eq('registration_id', registration.id)
      .or(
        row.membership_id
          ? `membership_id.eq.${row.membership_id},email.eq.${row.email}`
          : `email.eq.${row.email}`
      )
      .maybeSingle()

    const dob = row.date_of_birth || null
    const { eventRole, ageBracket } = roleFromType(row.type, dob)

    // Upsert a member row (non-fatal) so sheet-entered people get a member
    // account, a school link, and visibility on admin member pages.
    const memberId = await upsertMember(db, {
      email: row.email,
      first_name: row.first_name,
      last_name: row.last_name,
      phone: row.phone,
      date_of_birth: dob,
      gender: row.gender,
      grade: row.grade || null,
      t_shirt_size: row.t_shirt_size,
      age_bracket: ageBracket,
      event_role: eventRole,
    })
    if (memberId) syncedMemberIds.push(memberId)

    const payload = {
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
      phone: row.phone,
      date_of_birth: dob,
      gender: row.gender,
      t_shirt_size: row.t_shirt_size,
      grade: row.grade || null,
      dietary_requirements: row.dietary_requirements,
      health_conditions: row.health_conditions || null,
      emergency_contact_first_name: row.ec_first_name || null,
      emergency_contact_last_name: row.ec_last_name || null,
      emergency_contact_email: row.ec_email || null,
      emergency_contact_phone: row.ec_phone || null,
      emergency_contact_relationship: row.ec_relationship || null,
      event_role: eventRole,
      age_bracket: ageBracket,
      school_name: registration.school_name ?? '',
      ...(memberId ? { member_id: memberId } : {}),
    }

    let participantId: string | null = null
    if (existing) {
      await db.from('participants').update(payload).eq('id', existing.id)
      participantId = existing.id
      updated++
    } else {
      const { data: inserted } = await db
        .from('participants')
        .insert({ ...payload, registration_id: registration.id })
        .select('id')
        .single()
      participantId = inserted?.id ?? null
      created++
    }

    // Issue the agreement only when this participant doesn't already have an
    // envelope — so re-syncing the sheet never re-sends, but anyone still
    // missing paperwork (incl. rows added before this existed) gets it now.
    if (participantId) {
      const { data: env } = await db
        .from('docusign_envelopes')
        .select('id')
        .eq('participant_id', participantId)
        .limit(1)
        .maybeSingle()
      if (!env) {
        await dispatchAgreement(db, {
          participantId,
          memberId,
          eventSlug:         registration.event_slug,
          eventTitle:        registration.event_title,
          firstName:         row.first_name,
          lastName:          row.last_name,
          email:             row.email,
          phone:             row.phone,
          dateOfBirth:       dob,
          eventRole,
          schoolName:        registration.school_name ?? undefined,
          schoolState:       registration.school_address_state ?? undefined,
          guardianFirstName: row.ec_first_name || undefined,
          guardianLastName:  row.ec_last_name || undefined,
          guardianEmail:     row.ec_email || undefined,
          guardianPhone:     row.ec_phone || undefined,
          relationship:      row.ec_relationship || undefined,
        })
      }
    }
  }

  // Link every synced member to the group's school, and record the event in
  // each one's Event Activity (event_participations).
  await linkMembersToRegistrationSchool(db, registration.id, syncedMemberIds)
  await recordEventParticipationForRegistration(db, registration.id, syncedMemberIds)

  return { created, updated, syncedMemberIds }
}
