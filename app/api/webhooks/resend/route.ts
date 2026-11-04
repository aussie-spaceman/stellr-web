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
//   • the suppression list (lib/email/suppressions.ts): hard bounces and spam
//     complaints are recorded in email_suppressions, so sendEmail stops
//     sending non-critical mail to those addresses;
//   • Stellr signing invitations that bounce (lib/esign/bounces.ts).
// Both are idempotent, so a redelivered event changes nothing. A failure
// returns 500 and Resend retries.

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

  const db = supabaseServer()
  const { suppressed } = await handleSuppressionEvent(db, event)
  const result = await handleResendEvent(db, event)
  return NextResponse.json({ received: true, suppressed, ...result })
}
