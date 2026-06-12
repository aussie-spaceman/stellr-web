import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { watchSheet, isGoogleSheetsConfigured } from '@/lib/google-sheets'
import { ownsTeam } from '@/lib/team-access'
import { syncParticipantsFromSheet } from '@/lib/sheet-participant-sync'
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
    .select('id, email')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const { data: registration } = await db
    .from('registrations')
    .select('id, teacher_member_id, teacher_email, teacher_poc_email, spreadsheet_id, event_slug, event_title, school_name, school_address_state')
    .eq('id', registrationId)
    .eq('type', 'group')
    .maybeSingle()

  if (!registration) return NextResponse.json({ error: 'Team not found' }, { status: 404 })
  // Ownership by member id OR registrant email OR nominated teacher-POC email
  // (see lib/team-access).
  if (!ownsTeam(member, registration)) {
    console.warn('[teams/sheet-sync] Access denied', { registrationId, memberId: member.id })
    return NextResponse.json({ error: 'You do not have access to this team' }, { status: 403 })
  }
  if (!registration.spreadsheet_id) return NextResponse.json({ error: 'No spreadsheet linked to this team' }, { status: 400 })

  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json({ error: 'Google Sheets not configured' }, { status: 503 })
  }

  // Upsert members + participants and issue DocuSign for anyone missing it
  // (shared with the Google-Drive webhook so the two paths never drift).
  const { created, updated } = await syncParticipantsFromSheet(db, {
    id: registration.id,
    spreadsheet_id: registration.spreadsheet_id,
    school_name: registration.school_name,
    event_slug: registration.event_slug,
    event_title: registration.event_title,
    school_address_state: registration.school_address_state,
  })

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
