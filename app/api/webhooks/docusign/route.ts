import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { verifyConnectHmac } from '@/lib/docusign'
import { sendEmail, docusignCompletedToMinorEmail } from '@/lib/email'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

// DocuSign Connect delivers POST events when envelope status changes.
// Configure Connect in the DocuSign admin console to send JSON to this URL,
// with the HMAC key stored as DOCUSIGN_CONNECT_HMAC_KEY.

interface ConnectPayload {
  event: string
  data: {
    envelopeId: string
    envelopeSummary?: {
      status?: string
      completedDateTime?: string
      declinedDateTime?: string
    }
  }
}

const DS_STATUS_MAP: Record<string, string> = {
  'envelope-created':   'created',
  'envelope-sent':      'sent',
  'envelope-delivered': 'delivered',
  'envelope-completed': 'completed',
  'envelope-declined':  'declined',
  'envelope-voided':    'voided',
}

export async function POST(req: Request) {
  const rawBody = await req.text()

  const headerList = await headers()
  const signature = headerList.get('x-docusign-signature-1') ?? ''

  if (!verifyConnectHmac(rawBody, signature)) {
    console.error('[docusign-webhook] Invalid HMAC signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: ConnectPayload
  try {
    payload = JSON.parse(rawBody) as ConnectPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const newStatus = DS_STATUS_MAP[payload.event]
  if (!newStatus) return NextResponse.json({ received: true, skipped: 'unhandled event' })

  const envelopeId = payload.data?.envelopeId
  if (!envelopeId) return NextResponse.json({ received: true, skipped: 'no envelopeId' })

  const db = supabaseServer()
  const now = new Date().toISOString()

  const update: Record<string, string | null> = { status: newStatus, updated_at: now }
  if (newStatus === 'completed') update.completed_at = payload.data.envelopeSummary?.completedDateTime ?? now
  if (newStatus === 'declined')  update.declined_at  = payload.data.envelopeSummary?.declinedDateTime  ?? now

  const { data: envelope } = await db
    .from('docusign_envelopes')
    .update(update)
    .eq('envelope_id', envelopeId)
    .select('id, member_id, minor_name, signer_name, event_title')
    .maybeSingle()

  if (!envelope) {
    console.warn('[docusign-webhook] No envelope record for', envelopeId)
    return NextResponse.json({ received: true })
  }

  if (newStatus === 'completed' && envelope.member_id) {
    const { data: member } = await db
      .from('members')
      .select('email, first_name')
      .eq('id', envelope.member_id)
      .maybeSingle()

    if (member) {
      const downloadUrl = `${SITE_URL}/account?tab=profile`
      const content = docusignCompletedToMinorEmail({
        firstName:    member.first_name,
        guardianName: envelope.signer_name,
        eventTitle:   envelope.event_title,
        downloadUrl,
      })
      try {
        await sendEmail({ to: member.email, ...content })
      } catch (err) {
        console.error('[docusign-webhook] Failed to send completion email:', err)
      }
    }
  }

  return NextResponse.json({ received: true })
}
