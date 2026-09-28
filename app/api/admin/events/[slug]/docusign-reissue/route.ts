import { NextResponse } from 'next/server'
import { requireEventAccess } from '@/lib/event-access'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { reissueParticipantAgreement } from '@/lib/docusign-reissue'

// POST /api/admin/events/[slug]/docusign-reissue — the roster's "Reissue
// DocuSign" action (admins + assigned event managers).
//   body: { participantId: string, confirmNewEnvelope?: boolean }
// A live envelope is simply resent. Anything that would consume one of the
// monthly envelopes answers 409 { needsConfirm } first, and only proceeds when
// the caller repeats the request with confirmNewEnvelope: true.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = await req.json().catch(() => null)
  const participantId = typeof body?.participantId === 'string' ? body.participantId : null
  if (!participantId) return NextResponse.json({ error: 'participantId required' }, { status: 400 })

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

  const { data: part } = await db.from('participants').select('member_id').eq('id', participantId).maybeSingle()
  const actor = await actorFromAuth()
  const memberId = (part?.member_id as string | null) ?? actor.actorMemberId ?? null
  if (memberId) {
    await logActivity(
      {
        memberId,
        category: 'docusign',
        action: result.kind === 'resent' ? 'docusign_resent' : 'docusign_reissued',
        summary:
          result.kind === 'resent'
            ? `DocuSign re-sent for ${slug} (${result.recipients} outstanding signer${result.recipients === 1 ? '' : 's'})`
            : `New DocuSign issued for ${slug} (${result.outcome})`,
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
