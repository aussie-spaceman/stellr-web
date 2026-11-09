import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { executeDeletion, DeletionBlockedError } from '@/lib/deletion/execute'
import { memberIdForClerkUser } from '@/lib/deletion/actor'
import { notifyMember } from '@/lib/notify'
import { getEntityDef } from '@/lib/deletion/registry'
import { storableId, withAudit } from '@/lib/audit/route'

// A roster change waits out the group invoice quiet period after responding
// (lib/group-billing.ts), and that wait has to fit inside the function.
export const maxDuration = 300

// What this request acted on, which withAudit's spec cannot read for itself. The note is
// free text, so it stays out of the event: deletion_requests.review_note holds it.
interface Audited {
  id: string
  decision: string
  userId: string | null
  /** What the review was about, once the request is loaded. */
  subject?: { entity: string; entityId: string | null; eventSlug?: string }
  /** Only when a deletion ran: on any other path the requested mode did nothing. */
  mode?: string
  /** An approved school removes that member's link and leaves the school. */
  linkOnly?: boolean
  // Writes whose failure the answer does not show, so the row has to.
  linkDeleteFailed?: boolean
  requestUpdateFailed?: boolean
}
const audited = new WeakMap<Request, Audited>()

export const PATCH = withAudit(
  ({ args: [req] }: { args: [Request, { params: Promise<{ id: string }> }] }) => {
    const a = audited.get(req)
    return {
      action: 'deletion.request.review',
      actor: a ? { userId: a.userId } : { session: true },
      tenant: { stellr: true },
      target: { table: 'deletion_requests', id: a?.id ?? null },
      metadata: {
        decision: a?.decision ?? null,
        ...a?.subject,
        ...(a?.mode ? { mode: a.mode } : {}),
        ...(a?.linkOnly ? { linkOnly: true } : {}),
        ...(a?.linkDeleteFailed ? { linkDeleteFailed: true } : {}),
        ...(a?.requestUpdateFailed ? { requestUpdateFailed: true } : {}),
      },
    }
  },
  reviewDeletionRequest,
)

// PATCH /api/admin/deletion-requests/[id]  { action: 'approve' | 'reject', note?, mode? }
// Admin reviews a member-initiated deletion request from the Activity Review Log.
// Approving runs the actual deletion; a still-blocked item returns 409 so the
// admin clears the blockers first (the request stays pending).
async function reviewDeletionRequest(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId, sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => null)
  const action = body?.action as string | undefined
  const note = (body?.note as string | undefined) ?? null
  const mode = (body?.mode as string | undefined) === 'hard' ? 'hard' : 'soft'
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
  }
  const event: Audited = { id, decision: action, userId }
  audited.set(req, event)

  const db = supabaseServer()
  const reviewerId = await memberIdForClerkUser(userId)

  const { data: reqRow, error: loadErr } = await db
    .from('deletion_requests')
    .select('id, entity_type, entity_id, status, requested_by')
    .eq('id', id)
    .maybeSingle()
  if (loadErr || !reqRow) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (reqRow.status !== 'pending') {
    return NextResponse.json({ error: 'Request already reviewed' }, { status: 409 })
  }
  const entity = reqRow.entity_type as string
  const entityId = reqRow.entity_id as string
  event.subject = {
    entity,
    entityId: storableId(entityId),
    // An event is keyed by its slug, which is not stored as an id.
    ...(getEntityDef(entity)?.keyType === 'slug' ? { eventSlug: entityId } : {}),
  }

  if (action === 'reject') {
    event.requestUpdateFailed = await finalize(db, id, 'rejected', reviewerId, note)
    if (reqRow.requested_by) {
      await notifyMember(reqRow.requested_by as string, {
        type: 'action',
        body: `Your deletion request was declined${note ? `: ${note}` : '.'}`,
      }).catch(() => {})
    }
    return NextResponse.json({ success: true, status: 'rejected' })
  }

  // Approve → perform the deletion.
  try {
    if (reqRow.entity_type === 'school') {
      // Member "remove a school" = drop that member's link, not the whole school.
      event.linkOnly = true
      const { error: linkError } = await db
        .from('member_schools')
        .delete()
        .eq('school_id', reqRow.entity_id as string)
        .eq('member_id', reqRow.requested_by as string)
      event.linkDeleteFailed = !!linkError
    } else {
      event.mode = mode
      await executeDeletion(reqRow.entity_type as string, reqRow.entity_id as string, {
        mode,
        deletedBy: reviewerId,
      })
    }
  } catch (e) {
    if (e instanceof DeletionBlockedError) {
      return NextResponse.json({ error: 'Deletion blocked', blockers: e.blockers }, { status: 409 })
    }
    const msg = e instanceof Error ? e.message : 'Deletion failed'
    console.error('Deletion request approve error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  event.requestUpdateFailed = await finalize(db, id, 'approved', reviewerId, note)
  if (reqRow.requested_by) {
    await notifyMember(reqRow.requested_by as string, {
      type: 'action',
      body: 'Your deletion request has been approved and the item removed.',
    }).catch(() => {})
  }
  return NextResponse.json({ success: true, status: 'approved' })
}

/** True when the update failed. The answer stays as it was, so only the audit row says so. */
async function finalize(
  db: ReturnType<typeof supabaseServer>,
  id: string,
  status: 'approved' | 'rejected',
  reviewerId: string | null,
  note: string | null
): Promise<boolean> {
  const { error } = await db
    .from('deletion_requests')
    .update({ status, reviewed_by: reviewerId, reviewed_at: new Date().toISOString(), review_note: note })
    .eq('id', id)
  return !!error
}
