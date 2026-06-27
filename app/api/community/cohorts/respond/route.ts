import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { respondToInvite } from '@/lib/sessions'
import { supabaseServer } from '@/lib/supabase'
import { reportEnrollmentGate, accessGatesEnforced } from '@/lib/access-gates'

// POST /api/community/cohorts/respond — a member accepts or declines a pending
// cohort invite (PRD §11). Body: { cohortId, action: 'accept' | 'decline' }.
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { cohortId, action } = await req.json().catch(() => ({}))
  if (!cohortId || (action !== 'accept' && action !== 'decline')) {
    return NextResponse.json({ error: 'cohortId and a valid action are required' }, { status: 400 })
  }

  // Minor participation-agreement gate — block a minor joining a live cohort/workshop
  // without a signed agreement on file (report-only unless ACCESS_GATES_ENFORCE).
  if (action === 'accept') {
    const { data: c } = await supabaseServer()
      .from('mentoring_cohorts').select('container_type, name').eq('id', cohortId).maybeSingle()
    const kind = (c?.container_type === 'workshop' || c?.container_type === 'coaching') ? 'workshop' : 'cohort'
    const gate = await reportEnrollmentGate(member, { kind, containerId: cohortId, containerName: c?.name ?? undefined })
    if (accessGatesEnforced() && !gate.unlocked) {
      return NextResponse.json({ error: 'A signed participation agreement is required before joining.' }, { status: 403 })
    }
  }

  const ok = await respondToInvite(cohortId, member.id, action === 'accept')
  if (!ok) return NextResponse.json({ error: 'No pending invite found' }, { status: 400 })
  return NextResponse.json({ ok: true })
}
