import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { executeDeletion, DeletionBlockedError } from '@/lib/deletion/execute'
import { memberIdForClerkUser } from '@/lib/deletion/actor'
import { notifyMember } from '@/lib/notify'

// PATCH /api/admin/deletion-requests/[id]  { action: 'approve' | 'reject', note?, mode? }
// Admin reviews a member-initiated deletion request from the Activity Review Log.
// Approving runs the actual deletion; a still-blocked item returns 409 so the
// admin clears the blockers first (the request stays pending).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  if (action === 'reject') {
    await finalize(db, id, 'rejected', reviewerId, note)
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
      await db
        .from('member_schools')
        .delete()
        .eq('school_id', reqRow.entity_id as string)
        .eq('member_id', reqRow.requested_by as string)
    } else {
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

  await finalize(db, id, 'approved', reviewerId, note)
  if (reqRow.requested_by) {
    await notifyMember(reqRow.requested_by as string, {
      type: 'action',
      body: 'Your deletion request has been approved and the item removed.',
    }).catch(() => {})
  }
  return NextResponse.json({ success: true, status: 'approved' })
}

async function finalize(
  db: ReturnType<typeof supabaseServer>,
  id: string,
  status: 'approved' | 'rejected',
  reviewerId: string | null,
  note: string | null
) {
  await db
    .from('deletion_requests')
    .update({ status, reviewed_by: reviewerId, reviewed_at: new Date().toISOString(), review_note: note })
    .eq('id', id)
}
