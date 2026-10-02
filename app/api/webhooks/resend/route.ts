import { Webhook } from 'svix'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { handleResendEvent, type ResendEvent } from '@/lib/esign/bounces'

// POST /api/webhooks/resend — Resend's delivery events, signed with svix.
// Set up in Resend → Webhooks with the email.bounced event, pointing here; the
// signing secret goes in RESEND_WEBHOOK_SECRET. Used for Stellr signing
// invitations that bounce (lib/esign/bounces.ts).

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
  let event: ResendEvent
  try {
    // Also rejects a timestamp more than five minutes off: no replays.
    event = new Webhook(secret).verify(payload, { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': signature }) as ResendEvent
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const result = await handleResendEvent(supabaseServer(), event)
  return NextResponse.json({ received: true, ...result })
}
