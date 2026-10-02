import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { verifyConnectHmac } from '@/lib/docusign'
import { syncEnvelopeRecipients, loadRecipientsByEnvelopeRows, alertOnNewBounces } from '@/lib/docusign-recipients'
import {
  COMPLETED_ENVELOPE_COLUMNS,
  mayTransition,
  onEnvelopeCompleted,
  type CompletedEnvelope,
} from '@/lib/esign/completion'

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

  // Only DocuSign's own envelopes. A native row cannot share a DocuSign id, but
  // the filter makes that structural rather than a coincidence.
  const { data: current } = await db
    .from('docusign_envelopes')
    .select('id, status')
    .eq('envelope_id', envelopeId)
    .eq('provider', 'docusign')
    .maybeSingle()

  if (!current) {
    console.warn('[docusign-webhook] No envelope record for', envelopeId)
    return NextResponse.json({ received: true })
  }

  // ── Recipient-level state ────────────────────────────────────────────────────
  // Every event refreshes the full signer list, not just recipient-completed.
  // Recounted from DocuSign rather than incremented locally, so it stays
  // idempotent under Connect's at-least-once delivery.
  await syncRecipients(db, current.id as string, envelopeId)

  // recipient-* events carry no envelope-level status change of their own.
  if (payload.event.startsWith('recipient-')) {
    return NextResponse.json({ received: true })
  }

  const newStatus = DS_STATUS_MAP[payload.event]
  if (!newStatus) return NextResponse.json({ received: true, skipped: 'unhandled event' })

  // Connect does not guarantee order: a late "envelope-sent" must not turn a
  // completed consent form back into an unsigned one.
  if (!mayTransition(current.status as string, newStatus)) {
    return NextResponse.json({ received: true, skipped: `stale ${newStatus} after ${current.status}` })
  }

  const update: Record<string, string | null> = { status: newStatus, updated_at: now }
  if (newStatus === 'completed') update.completed_at = payload.data.envelopeSummary?.completedDateTime ?? now
  if (newStatus === 'declined')  update.declined_at  = payload.data.envelopeSummary?.declinedDateTime  ?? now

  const { data: envelope } = await db
    .from('docusign_envelopes')
    .update(update)
    .eq('id', current.id)
    .select(COMPLETED_ENVELOPE_COLUMNS + ', signers_total')
    .maybeSingle()

  if (envelope && newStatus === 'completed') {
    const row = envelope as unknown as CompletedEnvelope & { signers_total: number | null }
    // Envelope completion implies every signer finished.
    await db
      .from('docusign_envelopes')
      .update({ signers_completed: row.signers_total ?? 1 })
      .eq('id', row.id)
    await onEnvelopeCompleted(db, row)
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
  envelopeRowId: string,
  envelopeId: string,
): Promise<void> {
  try {
    const { data: row } = await db
      .from('docusign_envelopes')
      .select('id, minor_name, event_title, participant_id')
      .eq('id', envelopeRowId)
      .maybeSingle()
    if (!row) return

    const before = (await loadRecipientsByEnvelopeRows(db, [row.id as string])).get(row.id as string) ?? []
    const after = await syncEnvelopeRecipients(db, row.id as string, envelopeId, 'docusign')
    await alertOnNewBounces(before, after, {
      minorName:     (row.minor_name as string) ?? 'a participant',
      eventTitle:    (row.event_title as string) ?? '',
      participantId: (row.participant_id as string | null) ?? null,
    })
  } catch (err) {
    console.error('[docusign-webhook] recipient sync failed (non-fatal):', err)
  }
}
