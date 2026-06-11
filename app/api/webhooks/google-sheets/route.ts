import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { readSheetParticipants } from '@/lib/google-sheets'
import { upsertMember } from '@/lib/member-sync'
import { linkMembersToRegistrationSchool } from '@/lib/school-link'

// POST /api/webhooks/google-sheets
// Receives Google Drive push notifications when a watched sheet is modified.
export async function POST(req: NextRequest) {
  const channelId = req.headers.get('x-goog-channel-id')
  const resourceState = req.headers.get('x-goog-resource-state')

  // Initial sync notification — acknowledge and exit
  if (resourceState === 'sync' || !channelId) {
    return new NextResponse(null, { status: 200 })
  }

  // Only process actual updates
  if (resourceState !== 'update') {
    return new NextResponse(null, { status: 200 })
  }

  const db = supabaseServer()

  const { data: channel } = await db
    .from('sheet_watch_channels')
    .select('registration_id, expiration')
    .eq('channel_id', channelId)
    .maybeSingle()

  if (!channel) {
    console.warn('[webhook/google-sheets] Unknown channel_id:', channelId)
    return new NextResponse(null, { status: 200 })
  }

  // Ignore if channel has expired
  if (new Date(channel.expiration) <= new Date()) {
    return new NextResponse(null, { status: 200 })
  }

  const { data: registration } = await db
    .from('registrations')
    .select('id, spreadsheet_id, school_name')
    .eq('id', channel.registration_id)
    .maybeSingle()

  if (!registration?.spreadsheet_id) {
    return new NextResponse(null, { status: 200 })
  }

  try {
    const sheetRows = await readSheetParticipants(registration.spreadsheet_id)
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

      const isAdult = row.type?.toLowerCase() === 'adult'

      // Upsert a member row (non-fatal) so sheet-entered people get a member
      // account, a school link, and visibility on admin member pages.
      const memberId = await upsertMember(db, {
        email: row.email,
        first_name: row.first_name,
        last_name: row.last_name,
        phone: row.phone,
        date_of_birth: row.date_of_birth || null,
        gender: row.gender,
        grade: row.grade || null,
        t_shirt_size: row.t_shirt_size,
        age_bracket: isAdult ? 'adult' : 'high_school',
        event_role: isAdult ? 'adult' : 'school_student',
      })
      if (memberId) syncedMemberIds.push(memberId)

      const payload = {
        first_name: row.first_name,
        last_name: row.last_name,
        email: row.email,
        phone: row.phone,
        date_of_birth: row.date_of_birth || null,
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
        event_role: isAdult ? 'adult' : 'student',
        age_bracket: isAdult ? 'adult' : 'high_school',
        school_name: registration.school_name ?? '',
        ...(memberId ? { member_id: memberId } : {}),
      }

      if (existing) {
        await db.from('participants').update(payload).eq('id', existing.id)
      } else {
        await db.from('participants').insert({ ...payload, registration_id: registration.id })
      }
    }

    // Link every synced member to the group's school (from the registration).
    await linkMembersToRegistrationSchool(db, registration.id, syncedMemberIds)

    console.log(`[webhook/google-sheets] Synced ${sheetRows.length} rows for registration ${registration.id}`)
  } catch (err) {
    console.error('[webhook/google-sheets] Sync error:', err)
  }

  return new NextResponse(null, { status: 200 })
}
