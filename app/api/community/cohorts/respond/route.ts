import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { respondToInvite } from '@/lib/sessions'

// POST /api/community/cohorts/respond — a member accepts or declines a pending
// cohort invite (PRD §11). Body: { cohortId, action: 'accept' | 'decline' }.
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { cohortId, action } = await req.json().catch(() => ({}))
  if (!cohortId || (action !== 'accept' && action !== 'decline')) {
    return NextResponse.json({ error: 'cohortId and a valid action are required' }, { status: 400 })
  }

  const ok = await respondToInvite(cohortId, member.id, action === 'accept')
  if (!ok) return NextResponse.json({ error: 'No pending invite found' }, { status: 400 })
  return NextResponse.json({ ok: true })
}
