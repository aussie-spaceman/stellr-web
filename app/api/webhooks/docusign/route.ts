import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { verifyConnectHmac, getEnvelopeSignerProgress, type AgreementType } from '@/lib/docusign'
import { AGREEMENT_LABEL } from '@/lib/docusign-agreements'
import { sendEmail, docusignCompletedToMinorEmail, docusignCompletedToSignerEmail } from '@/lib/email'

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

export async function GET() {
  return NextResponse.json({ ok: true })
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

  const envelopeId = payload.data?.envelopeId
  if (!envelopeId) return NextResponse.json({ received: true, skipped: 'no envelopeId' })

  const db = supabaseServer()
  const now = new Date().toISOString()

  // Recipient-level signing progress (roster "partially complete" pill).
  // Recount from the recipients API rather than incrementing locally —
  // idempotent under DocuSign Connect's at-least-once delivery.
  if (payload.event === 'recipient-completed') {
    try {
      const progress = await getEnvelopeSignerProgress(envelopeId)
      await db
        .from('docusign_envelopes')
        .update({ signers_total: progress.total, signers_completed: progress.completed, updated_at: now })
        .eq('envelope_id', envelopeId)
    } catch (err) {
      console.error('[docusign-webhook] Failed to update signer progress:', err)
    }
    return NextResponse.json({ received: true })
  }

  const newStatus = DS_STATUS_MAP[payload.event]
  if (!newStatus) return NextResponse.json({ received: true, skipped: 'unhandled event' })

  const update: Record<string, string | null> = { status: newStatus, updated_at: now }
  if (newStatus === 'completed') update.completed_at = payload.data.envelopeSummary?.completedDateTime ?? now
  if (newStatus === 'declined')  update.declined_at  = payload.data.envelopeSummary?.declinedDateTime  ?? now

  const { data: envelope } = await db
    .from('docusign_envelopes')
    .update(update)
    .eq('envelope_id', envelopeId)
    .select('id, member_id, envelope_type, minor_name, signer_name, event_title, signers_total')
    .maybeSingle()

  // Envelope completion implies every signer finished.
  if (envelope && newStatus === 'completed') {
    await db
      .from('docusign_envelopes')
      .update({ signers_completed: envelope.signers_total ?? 1 })
      .eq('id', envelope.id)
  }

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
      const type = (envelope.envelope_type ?? 'minor') as AgreementType
      const content = type === 'minor'
        ? docusignCompletedToMinorEmail({
            firstName:    member.first_name,
            guardianName: envelope.signer_name,
            eventTitle:   envelope.event_title,
            downloadUrl,
          })
        : docusignCompletedToSignerEmail({
            firstName:     member.first_name,
            eventTitle:    envelope.event_title,
            downloadUrl,
            agreementLabel: AGREEMENT_LABEL[type],
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
