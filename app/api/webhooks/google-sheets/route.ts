import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { SHEET_SYNC_COLUMNS, syncParticipantsFromSheet } from '@/lib/sheet-participant-sync'
import { safeStrEqual } from '@/lib/secret-compare'

// A roster change waits out the group invoice quiet period after responding
// (lib/group-billing.ts), and that wait has to fit inside the function.
export const maxDuration = 300

// POST /api/webhooks/google-sheets
// Receives Google Drive push notifications when a watched sheet is modified.
//
// Google does not sign these, so each channel carries a random token we chose when
// registering it (sheet_watch_channels.token, set by the sheet-sync route). Google
// echoes it in X-Goog-Channel-Token; it is compared in constant time with the stored
// copy, and a missing or wrong token is answered exactly like an unknown channel
// (200, nothing done) so a prober learns nothing from the reply (threat model §6.11).
//
// Transition: a channel registered before tokens existed has token NULL. It is
// honoured, with a warning, until its own expiration (at most 6 days after it was
// registered) and refused after that. The next "Sync From Sheet" re-registers the
// sheet with a token, so nothing needs migrating by hand.
export async function POST(req: NextRequest) {
  const channelId = req.headers.get('x-goog-channel-id')
  const channelToken = req.headers.get('x-goog-channel-token')
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
    .select('registration_id, expiration, token')
    .eq('channel_id', channelId)
    .maybeSingle()

  if (!channel) {
    console.warn('[webhook/google-sheets] Unknown channel_id:', channelId)
    return new NextResponse(null, { status: 200 })
  }

  const expired = new Date(channel.expiration) <= new Date()
  if (channel.token == null) {
    // Registered before channel tokens. Refused once expired, like any expired channel.
    if (expired) return new NextResponse(null, { status: 200 })
    console.warn('[webhook/google-sheets] Channel has no token (registered before tokens); accepted until it expires:', channelId)
  } else if (channelToken == null || !safeStrEqual(channelToken, channel.token)) {
    console.warn('[webhook/google-sheets] Channel token missing or wrong for channel_id:', channelId)
    return new NextResponse(null, { status: 200 })
  }

  // Ignore if channel has expired
  if (expired) {
    return new NextResponse(null, { status: 200 })
  }

  const { data: registration } = await db
    .from('registrations')
    .select(SHEET_SYNC_COLUMNS)
    .eq('id', channel.registration_id)
    .maybeSingle()

  if (!registration?.spreadsheet_id) {
    return new NextResponse(null, { status: 200 })
  }

  try {
    // Same upsert + DocuSign dispatch + individual-payment notices as the manual
    // "Sync From Sheet" button. S5 A8: the registration's tenant decides whose rules
    // apply; a refusal (SheetSyncRefused) is logged below like any other failure.
    const { created, updated, paymentLinksSent } = await syncParticipantsFromSheet(db, registration)
    console.log(`[webhook/google-sheets] Synced registration ${registration.id} (${created} created, ${updated} updated, ${paymentLinksSent} payment notices sent)`)
  } catch (err) {
    console.error('[webhook/google-sheets] Sync error:', err)
  }

  return new NextResponse(null, { status: 200 })
}
