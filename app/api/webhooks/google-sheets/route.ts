import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { syncParticipantsFromSheet } from '@/lib/sheet-participant-sync'

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
    .select('id, spreadsheet_id, school_name, event_slug, event_title, school_address_state')
    .eq('id', channel.registration_id)
    .maybeSingle()

  if (!registration?.spreadsheet_id) {
    return new NextResponse(null, { status: 200 })
  }

  try {
    // Same upsert + DocuSign dispatch as the manual "Sync From Sheet" button.
    const { created, updated } = await syncParticipantsFromSheet(db, {
      id: registration.id,
      spreadsheet_id: registration.spreadsheet_id,
      school_name: registration.school_name,
      event_slug: registration.event_slug,
      event_title: registration.event_title,
      school_address_state: registration.school_address_state,
    })
    console.log(`[webhook/google-sheets] Synced registration ${registration.id} (${created} created, ${updated} updated)`)
  } catch (err) {
    console.error('[webhook/google-sheets] Sync error:', err)
  }

  return new NextResponse(null, { status: 200 })
}
