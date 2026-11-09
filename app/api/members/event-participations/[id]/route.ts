import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { assertNotImpersonating } from '@/lib/impersonation'
import { auditMutation } from '@/lib/audit/route'
import { selfServiceEvent, writeNotingTarget, type SelfServiceAudit } from '@/lib/community/self-service-audit'

// DELETE /api/members/event-participations/[id] — member deletes own event record
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return audited(req, { action: 'member.event_participation.delete', table: 'event_participations' }, () => deleteParticipation(req, ctx))
}

async function deleteParticipation(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — see lib/impersonation.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const db = supabaseServer()

  const { data: member } = await db
    .from('members')
    .select('id')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .single()

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  // Only allow deleting pending records — approved records are locked by admin
  const { error } = await writeNotingTarget(
    req,
    db
      .from('event_participations')
      .delete()
      .eq('id', id)
      .eq('member_id', member.id)
      .eq('status', 'pending'),
  )

  if (error) {
    console.error('Event participation delete error:', error)
    return NextResponse.json({ error: 'Failed to delete record' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

// The audit event for this route (docs/TENANCY-S5.md, B16): written after the response,
// never for a 4xx, ids and short codes only. lib/community/self-service-audit decides
// what is written; the call stays here because the coverage gate reads it here.
async function audited(req: Request, spec: SelfServiceAudit, run: () => Promise<Response>): Promise<Response> {
  let res: Response | undefined
  try {
    return (res = await run())
  } finally {
    await record(req, res, spec)
  }
}

async function record(req: Request, res: Response | undefined, spec: SelfServiceAudit) {
  const event = await selfServiceEvent(req, res, spec)
  if (!event) return
  await auditMutation(event, { afterResponse: true })
}
