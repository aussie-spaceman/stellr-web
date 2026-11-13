import { NextResponse } from 'next/server'
import { requireEventRoute } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import { reissueParticipantAgreement } from '@/lib/docusign-reissue'
import { describeDispatchOutcome } from '@/lib/docusign-status'
import { loadRecord, refuseOutsideStellr, refuseUnlessStellrEvent } from '@/lib/tenancy/load-scoped'

// POST /api/admin/events/[slug]/docusign-reissue — the roster's "Reissue
// DocuSign" action (admins + assigned event managers).
//   body: { participantId: string, confirmNewEnvelope?: boolean }
// A live envelope is simply resent. Anything that would consume one of the
// monthly envelopes answers 409 { needsConfirm } first, and only proceeds when
// the caller repeats the request with confirmNewEnvelope: true.
//
// Stellr's signing accounts and shared member records: C22 and A11 open this to a tenant.

const ROUTE = '/api/admin/events/[slug]/docusign-reissue'

type Ctx = { params: Promise<{ slug: string }> }

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'agreement.participant.reissue', ...auditSubject(req, 'participants') }),
  reissueAgreement,
)

async function reissueAgreement(req: Request, { params }: Ctx) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, eventSlug: slug })
  const refused = refuseOutsideStellr(crew.scope)
  if (refused) return refused
  const foreign = await refuseUnlessStellrEvent(supabaseServer(), slug, ROUTE)
  if (foreign) return foreign

  const body = await req.json().catch(() => null)
  const participantId = typeof body?.participantId === 'string' ? body.participantId : null
  if (!participantId) return NextResponse.json({ error: 'participantId required' }, { status: 400 })
  noteAuditSubject(req, { id: participantId })

  const db = supabaseServer()
  let result
  try {
    result = await reissueParticipantAgreement(db, participantId, {
      eventSlug: slug,
      allowNewEnvelope: body?.confirmNewEnvelope === true,
    })
  } catch (err) {
    console.error('[admin/docusign-reissue] failed:', err)
    return NextResponse.json({ error: 'DocuSign did not accept the request — try again shortly' }, { status: 502 })
  }

  switch (result.kind) {
    case 'not_found':
      return NextResponse.json({ error: 'Participant not found for this event' }, { status: 404 })
    case 'nothing_to_do':
      return NextResponse.json({ error: result.message }, { status: 400 })
    case 'needs_confirm':
      return NextResponse.json({ needsConfirm: result.reason, message: result.message }, { status: 409 })
    case 'reissued':
      if (result.outcome === 'failed') {
        return NextResponse.json({ error: 'DocuSign rejected the new envelope — admins have been alerted' }, { status: 502 })
      }
      break
  }

  // Reached only for a participant the reissue found on this event.
  const part = await loadRecord<{ member_id: string | null }>(crew.scope, 'participants', participantId, {
    db,
    select: 'member_id',
    notFound: () => NextResponse.json({ error: 'Participant not found for this event' }, { status: 404 }),
    label: ROUTE,
  })
  const actor = await actorFromAuth()
  const memberId = (part.ok ? part.row.member_id : null) ?? actor.actorMemberId ?? null
  if (memberId) {
    const issued = result.kind === 'reissued' && result.outcome === 'issued'
    await logActivity(
      {
        memberId,
        category: 'docusign',
        // "Issued" only when an envelope actually went out: this history is what
        // staff read to see what a member was sent.
        action: result.kind === 'resent' ? 'docusign_resent' : issued ? 'docusign_reissued' : 'docusign_reissue_no_send',
        summary:
          result.kind === 'resent'
            ? `DocuSign re-sent for ${slug} (${result.recipients} outstanding signer${result.recipients === 1 ? '' : 's'})`
            : issued
              ? `New DocuSign issued for ${slug}`
              : `DocuSign reissue for ${slug}: ${describeDispatchOutcome(result.outcome)}`,
        metadata: { participantId, eventSlug: slug, ...result },
        ...actor,
      },
      db,
    )
  }

  return NextResponse.json(
    result.kind === 'resent'
      ? { ok: true, action: 'resent', recipients: result.recipients }
      : { ok: true, action: 'reissued', outcome: result.outcome },
  )
}
