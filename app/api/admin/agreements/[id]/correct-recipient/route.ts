import { NextResponse } from 'next/server'
import { requireEventAccess } from '@/lib/event-access'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { correctAgreementRecipient } from '@/lib/agreement-correction'
import { maskEmail } from '@/lib/utils'
import { syncEnvelopeRecipients } from '@/lib/docusign-recipients'

// "Correct email" on a live agreement (admins, and event managers for their
// own events). Changes the signer's address on the same agreement: signatures
// already given are kept and no new envelope is used. See
// lib/agreement-correction.ts.

type Db = ReturnType<typeof supabaseServer>

/** Null when the caller may act on this agreement, otherwise the response to send. */
async function guard(db: Db, id: string): Promise<NextResponse | null> {
  const { data: row } = await db.from('agreements').select('event_slug').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Agreement not found' }, { status: 404 })
  const slug = (row.event_slug as string | null) || undefined
  const access = await requireEventAccess(slug)
  // An agreement with no event (a membership agreement) is admins only.
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  if (!slug && !access.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return null
}

// GET — the agreement's signers, for the dialog: { status, recipients[] }.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = supabaseServer()
  const denied = await guard(db, id)
  if (denied) return denied

  const { data: env } = await db.from('agreements').select('envelope_id, provider, status').eq('id', id).maybeSingle()
  // Refresh from the engine first: the dialog must show who has signed now,
  // not as of the last Connect event (and an envelope never synced has no rows).
  if (env && (env.status === 'sent' || env.status === 'delivered')) {
    await syncEnvelopeRecipients(db, id, env.envelope_id as string, env.provider as string | null).catch((err) =>
      console.error(`[admin/correct-recipient] sync failed for ${id}:`, err),
    )
  }
  const { data: recipients } = await db
    .from('agreement_recipients')
    .select('recipient_id, role_name, name, email, status, routing_order')
    .eq('envelope_row', id)
    .order('routing_order', { ascending: true })
  return NextResponse.json({
    status: env?.status ?? null,
    recipients: (recipients ?? []).map((r) => ({
      recipientId: r.recipient_id,
      roleName: r.role_name,
      name: r.name,
      email: r.email,
      status: r.status,
      routingOrder: r.routing_order,
    })),
  })
}

// POST — body: { recipientId: string, email: string, name?: string }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = supabaseServer()
  const denied = await guard(db, id)
  if (denied) return denied

  const body = await req.json().catch(() => null)
  const recipientId = typeof body?.recipientId === 'string' ? body.recipientId : null
  const email = typeof body?.email === 'string' ? body.email : null
  const name = typeof body?.name === 'string' ? body.name : undefined
  if (!recipientId || !email) return NextResponse.json({ error: 'recipientId and email are required' }, { status: 400 })

  let result
  try {
    result = await correctAgreementRecipient(db, { agreementId: id, recipientId, email, name })
  } catch (err) {
    console.error('[admin/correct-recipient] failed:', err)
    return NextResponse.json({ error: 'The signing service did not accept the change. Try again shortly.' }, { status: 502 })
  }

  if (result.kind === 'not_found') return NextResponse.json({ error: 'Agreement not found' }, { status: 404 })
  if (result.kind === 'refused') {
    return NextResponse.json({ error: result.message, code: result.code }, { status: result.code === 'INVALID_EMAIL' ? 400 : 409 })
  }

  const actor = await actorFromAuth()
  const memberId = result.memberId ?? actor.actorMemberId ?? null
  if (memberId) {
    await logActivity(
      {
        memberId,
        category: 'docusign',
        action: 'docusign_corrected',
        summary: `Signer email corrected${result.eventSlug ? ` for ${result.eventSlug}` : ''}: ${maskEmail(result.previousEmail)} → ${maskEmail(result.recipient.email)}`,
        metadata: {
          agreementId: id,
          envelopeId: result.envelopeId,
          provider: result.provider,
          recipientId,
          role: result.recipient.roleName,
          from: result.previousEmail,
          to: result.recipient.email,
          participantId: result.participantId,
          participantField: result.participantField,
          participantSkipped: result.participantSkipped,
        },
        ...actor,
      },
      db,
    )
  }

  return NextResponse.json({
    ok: true,
    recipient: result.recipient,
    participantField: result.participantField,
    participantSkipped: result.participantSkipped,
  })
}
