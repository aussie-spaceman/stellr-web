import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { verifyConnectHmac, type AgreementType } from '@/lib/docusign'
import { AGREEMENT_LABEL } from '@/lib/docusign-agreements'
import { syncEnvelopeRecipients, loadRecipientsByEnvelopeRows, alertOnNewBounces } from '@/lib/docusign-recipients'
import { sendEmail, docusignCompletedToMinorEmail, docusignCompletedToSignerEmail } from '@/lib/email'
import { logActivity } from '@/lib/activity-log'

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

  // ── Recipient-level state ────────────────────────────────────────────────────
  // Every event refreshes the full signer list, not just recipient-completed.
  // The API call was always being made here; it just kept two integers and threw
  // the rest away, which is why nothing downstream could name the outstanding
  // signer, notice a bounced address, or tell "never opened it" from "opened it
  // yesterday". Recounted from DocuSign rather than incremented locally, so it
  // stays idempotent under Connect's at-least-once delivery.
  await syncRecipients(db, envelopeId)

  // recipient-* events carry no envelope-level status change of their own.
  if (payload.event.startsWith('recipient-')) {
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
    const dsType = (envelope.envelope_type ?? 'minor') as AgreementType
    await logActivity({
      memberId: envelope.member_id,
      category: 'docusign',
      action: 'docusign_completed',
      summary: `${AGREEMENT_LABEL[dsType] ?? 'Consent form'} completed${envelope.event_title ? ` for ${envelope.event_title}` : ''}`,
      metadata: { envelopeId, agreementType: dsType, eventTitle: envelope.event_title ?? null },
      actorType: 'docusign',
    }, db)

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

// Mirrors DocuSign's signer list into docusign_envelope_recipients and raises an
// admin alert the first time an address is reported bounced. Non-fatal
// throughout: a DocuSign hiccup here must not stop the envelope's status change
// from being recorded, and must not make us return non-2xx (Connect would retry
// the whole event, re-running the side effects below it).
async function syncRecipients(
  db: ReturnType<typeof supabaseServer>,
  envelopeId: string,
): Promise<void> {
  try {
    const { data: row } = await db
      .from('docusign_envelopes')
      .select('id, minor_name, event_title, participant_id')
      .eq('envelope_id', envelopeId)
      .maybeSingle()
    if (!row) return

    const before = (await loadRecipientsByEnvelopeRows(db, [row.id as string])).get(row.id as string) ?? []
    const after = await syncEnvelopeRecipients(db, row.id as string, envelopeId)
    await alertOnNewBounces(before, after, {
      minorName:     (row.minor_name as string) ?? 'a participant',
      eventTitle:    (row.event_title as string) ?? '',
      participantId: (row.participant_id as string | null) ?? null,
    })
  } catch (err) {
    console.error('[docusign-webhook] recipient sync failed (non-fatal):', err)
  }
}
