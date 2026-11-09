import { NextResponse } from 'next/server'
import { requireEventStaff, type EventStaff } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { correctAgreementRecipient } from '@/lib/agreement-correction'
import { maskEmail } from '@/lib/utils'
import { syncEnvelopeRecipients } from '@/lib/docusign-recipients'
import { withAudit } from '@/lib/audit/route'
import { loadEventRecord, loadScopedRows } from '@/lib/tenancy/load-scoped'
import { isStellrScope } from '@/lib/tenancy/scope-context'

// "Correct email" on a live agreement (admins, and event managers for their
// own events). Changes the signer's address on the same agreement: signatures
// already given are kept and no new envelope is used. See
// lib/agreement-correction.ts.

const ROUTE = '/api/admin/agreements/[id]/correct-recipient'

type Db = ReturnType<typeof supabaseServer>
type Agreement = { event_slug: string | null; envelope_id: string; provider: string | null; status: string | null }
type Staff = Extract<EventStaff, { ok: true }>

const notFound = () => NextResponse.json({ error: 'Agreement not found' }, { status: 404 })

/** The agreement when the caller may act on it, otherwise the response to send. */
async function guard(db: Db, id: string, req: Request): Promise<{ staff: Staff; row: Agreement } | { denied: Response }> {
  // Who is asking comes first: a signed-out caller gets 401 before any
  // lookup, so the route never says whether an agreement id exists.
  const staff = await requireEventStaff({ route: ROUTE })
  if (!staff.ok) return { denied: NextResponse.json({ error: 'Forbidden' }, { status: staff.status }) }
  audited.set(req, { id, userId: staff.userId, tenantId: staff.tenantId })

  // An event manager reaches only their own events. An agreement with no event (a
  // membership agreement) is admins only.
  const loaded = await loadEventRecord<Agreement>(staff, 'agreements', id, {
    db,
    select: 'event_slug, envelope_id, provider, status',
    notFound,
    label: ROUTE,
  })
  return loaded.ok ? { staff, row: loaded.row } : { denied: loaded.response }
}

// What this request acted on, which withAudit's spec cannot read for itself.
const audited = new WeakMap<Request, { id: string; userId: string; tenantId: string }>()

type Args = [Request, { params: Promise<{ id: string }> }]

function eventFor(req: Request) {
  const a = audited.get(req)
  return {
    actor: a ? { userId: a.userId } : { session: true as const },
    tenant: { tenantId: a?.tenantId ?? null },
    target: { table: 'agreements', id: a?.id ?? null },
  }
}

// GET — the agreement's signers, for the dialog: { status, recipients[] }.
// Refreshing them from the engine writes, so this is audited like the POST.
export const GET = withAudit(({ args: [req] }: { args: Args }) => ({ action: 'agreement.recipient.sync', ...eventFor(req) }), listRecipients)

async function listRecipients(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = supabaseServer()
  const g = await guard(db, id, req)
  if ('denied' in g) return g.denied

  const env = g.row
  // Refresh from the engine first: the dialog must show who has signed now,
  // not as of the last Connect event (and an envelope never synced has no rows).
  if (env.status === 'sent' || env.status === 'delivered') {
    await syncEnvelopeRecipients(db, id, env.envelope_id, env.provider).catch((err) =>
      console.error(`[admin/correct-recipient] sync failed for ${id}:`, err),
    )
  }
  const { data: recipients } = await loadScopedRows<{
    recipient_id: string
    role_name: string | null
    name: string | null
    email: string | null
    status: string | null
    routing_order: number | null
  }>(g.staff.scope, 'agreement_recipients', {
    db,
    select: 'recipient_id, role_name, name, email, status, routing_order',
    match: { envelope_row: id },
    order: { column: 'routing_order', ascending: true },
    label: ROUTE,
  })
  return NextResponse.json({
    status: env.status ?? null,
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
export const POST = withAudit(({ args: [req] }: { args: Args }) => ({ action: 'agreement.recipient.correct', ...eventFor(req) }), correctRecipient)

async function correctRecipient(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = supabaseServer()
  const g = await guard(db, id, req)
  if ('denied' in g) return g.denied

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

  if (result.kind === 'not_found') return notFound()
  if (result.kind === 'refused') {
    return NextResponse.json({ error: result.message, code: result.code }, { status: result.code === 'INVALID_EMAIL' ? 400 : 409 })
  }

  const actor = await actorFromAuth()
  const memberId = result.memberId ?? actor.actorMemberId ?? null
  // The member's activity log is global, and a tenant's records stay off it (owner decision B8).
  if (memberId && isStellrScope(g.staff.scope)) {
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
