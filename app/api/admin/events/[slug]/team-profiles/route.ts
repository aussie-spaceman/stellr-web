import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventRoute } from '@/lib/authz'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import { resendOutstanding, resendTeamProfile } from '@/lib/team-profile/store'
import { refuseOutsideStellr } from '@/lib/tenancy/load-scoped'

export const maxDuration = 60

// Team profile sends from the roster (admins + assigned event managers).
//   POST { participantId }  — send (or re-send) one student's team profile
//   POST { all: true }      — send to every student who hasn't submitted yet
// Either way, only students whose permission form is complete get one.
//
// Stellr's sender: A10 and B13 open this to a tenant.

const ROUTE = '/api/admin/events/[slug]/team-profiles'

type Params = { params: Promise<{ slug: string }> }

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, Params] }) => ({ action: 'team_profile.invite.send', ...auditSubject(req, 'participants') }),
  sendProfiles,
)

async function sendProfiles(req: Request, { params }: Params) {
  const { slug } = await params
  const staff = await requireEventRoute(slug, { route: ROUTE })
  if (!staff.ok) return staff.response
  noteAuditSubject(req, { userId: staff.userId, tenantId: staff.tenantId, eventSlug: slug })
  const refused = refuseOutsideStellr(staff.scope)
  if (refused) return refused

  const body = await req.json().catch(() => null)
  const db = supabaseServer()

  if (typeof body?.participantId === 'string') {
    noteAuditSubject(req, { id: body.participantId })
    const result = await resendTeamProfile(db, slug, body.participantId)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ ok: true })
  }

  if (body?.all === true) {
    try {
      const result = await resendOutstanding(db, slug)
      noteAuditSubject(req, { detail: { sent: result.sent, failed: result.failed } })
      return NextResponse.json({ ok: true, ...result })
    } catch (err) {
      console.error('[team-profiles] bulk send failed:', err)
      return NextResponse.json({ error: 'Sending failed.' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'participantId or all required' }, { status: 400 })
}
