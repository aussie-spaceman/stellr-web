import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { readSheetParticipants, watchSheet, isGoogleSheetsConfigured } from '@/lib/google-sheets'
import { randomUUID } from 'crypto'

// POST /api/members/teams/[id]/sheet-sync
// Reads the linked Google Sheet and upserts participant records.
// Also registers a push notification channel if one isn't active.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id: registrationId } = await params
  const db = supabaseServer()

  const { data: member } = await db
    .from('members')
    .select('id, event_role')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (member.event_role !== 'teacher' && member.event_role !== 'school_student_manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: registration } = await db
    .from('registrations')
    .select('id, teacher_member_id, spreadsheet_id, event_title')
    .eq('id', registrationId)
    .eq('type', 'group')
    .maybeSingle()

  if (!registration) return NextResponse.json({ error: 'Team not found' }, { status: 404 })
  if (registration.teacher_member_id !== member.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!registration.spreadsheet_id) return NextResponse.json({ error: 'No spreadsheet linked to this team' }, { status: 400 })

  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json({ error: 'Google Sheets not configured' }, { status: 503 })
  }

  // Read sheet rows
  const sheetRows = await readSheetParticipants(registration.spreadsheet_id)

  let updated = 0
  let created = 0

  for (const row of sheetRows) {
    if (!row.first_name && !row.email) continue

    // Try to find existing participant by membership_id or email
    const { data: existing } = await db
      .from('participants')
      .select('id')
      .eq('registration_id', registrationId)
      .or(
        row.membership_id
          ? `membership_id.eq.${row.membership_id},email.eq.${row.email}`
          : `email.eq.${row.email}`
      )
      .maybeSingle()

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
      event_role: row.type?.toLowerCase() === 'adult' ? 'adult' : 'student',
      age_bracket: row.type?.toLowerCase() === 'adult' ? 'adult' : 'high_school',
      school_name: '',
    }

    if (existing) {
      await db.from('participants').update(payload).eq('id', existing.id)
      updated++
    } else {
      await db.from('participants').insert({ ...payload, registration_id: registrationId })
      created++
    }
  }

  // Register watch channel if not already active
  let watchActive = false
  const { data: existingChannel } = await db
    .from('sheet_watch_channels')
    .select('expiration')
    .eq('registration_id', registrationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!existingChannel || new Date(existingChannel.expiration) <= new Date()) {
    try {
      const channelId = randomUUID()
      const result = await watchSheet(registration.spreadsheet_id, channelId)
      await db.from('sheet_watch_channels').insert({
        registration_id: registrationId,
        channel_id: result.channel_id,
        resource_id: result.resource_id,
        expiration: result.expiration.toISOString(),
      })
      watchActive = true
    } catch (err) {
      console.error('[sheet-sync] Watch setup failed (non-fatal):', err)
    }
  } else {
    watchActive = true
  }

  return NextResponse.json({ updated, created, watchActive })
}
