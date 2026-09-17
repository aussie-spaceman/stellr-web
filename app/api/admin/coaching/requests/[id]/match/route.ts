import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { matchRequest, type CoachingEligibility } from '@/lib/coaching-requests'
import { isAdminClaims } from '@/lib/admin-auth'

const ELIGIBILITIES: CoachingEligibility[] = ['included', 'award', 'paid']

// Admin: match a coach to a pending coaching request + resolve eligibility.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const coachId = typeof body?.coachId === 'string' ? body.coachId : ''
  const eligibility = body?.eligibility as CoachingEligibility
  if (!coachId) return NextResponse.json({ error: 'Select a coach.' }, { status: 400 })
  if (!ELIGIBILITIES.includes(eligibility)) return NextResponse.json({ error: 'Select an eligibility.' }, { status: 400 })

  const result = await matchRequest(id, coachId, eligibility)
  if (!result.ok) return NextResponse.json({ error: result.error ?? 'Could not match' }, { status: 400 })
  return NextResponse.json({ ok: true })
}
