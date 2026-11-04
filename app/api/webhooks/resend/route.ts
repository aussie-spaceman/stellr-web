import { Webhook } from 'svix'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { handleResendEvent } from '@/lib/esign/bounces'
import { handleSuppressionEvent, type ResendDeliveryEvent } from '@/lib/email/suppressions'

// POST /api/webhooks/resend — Resend's delivery events, signed with svix.
// Set up in Resend → Webhooks with the email.bounced and email.complained
// events, pointing here; the signing secret goes in RESEND_WEBHOOK_SECRET.
// Without the secret every call is refused.
//
// Two consumers:
//   • Stellr signing invitations that bounce (lib/esign/bounces.ts);
//   • the suppression list (lib/email/suppressions.ts): permanent bounces and
//     spam complaints are recorded in email_suppressions, so sendEmail stops
//     sending non-critical mail to those addresses.
// Both are idempotent, so a redelivered event changes nothing. A failure in
// either returns 500 and Resend retries; one failing never stops the other.

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    console.error('[webhooks/resend] RESEND_WEBHOOK_SECRET not set')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  const id = req.headers.get('svix-id')
  const timestamp = req.headers.get('svix-timestamp')
  const signature = req.headers.get('svix-signature')
  if (!id || !timestamp || !signature) return NextResponse.json({ error: 'Missing signature headers' }, { status: 400 })

  const payload = await req.text()
  if (payload.length > 64_000) return NextResponse.json({ error: 'Too large' }, { status: 413 })
  let event: ResendDeliveryEvent
  try {
    // Also rejects a timestamp more than five minutes off: no replays. svix 2
    // only verifies, so the payload is parsed here, still inside the try.
    new Webhook(secret).verify(payload, { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': signature })
    event = JSON.parse(payload) as ResendDeliveryEvent
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }
  if (!event || typeof event.type !== 'string') return NextResponse.json({ error: 'Malformed event' }, { status: 400 })

  // The two consumers run independently, signing bounces first: they were here
  // before the suppression list, and a failed suppression write (the table
  // missing because code deployed before the migration, or any write error)
  // must never stop a bounced consent form reaching the roster and staff. Each
  // failure is logged; either one returns 500 so Resend retries. A retry is
  // safe: both handlers are idempotent, and the signing half does not alert
  // twice because the signer is no longer 'sent'.
  const db = supabaseServer()
  let bounced = 0
  let suppressed = 0
  let failed = false
  try {
    ;({ bounced } = await handleResendEvent(db, event))
  } catch (err) {
    failed = true
    console.error('[webhooks/resend] signing bounce not recorded:', err instanceof Error ? err.message : err)
  }
  try {
    ;({ suppressed } = await handleSuppressionEvent(db, event))
  } catch (err) {
    failed = true
    console.error('[webhooks/resend] suppression not recorded:', err instanceof Error ? err.message : err)
  }
  if (failed) return NextResponse.json({ error: 'Not fully recorded; retry', bounced, suppressed }, { status: 500 })
  return NextResponse.json({ received: true, suppressed, bounced })
}
