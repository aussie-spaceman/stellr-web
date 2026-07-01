import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { createCoachingRequest } from '@/lib/coaching-requests'

// Create a member-initiated coaching request (public /academy/coaching/request
// intake submits here). Auth is enforced at submit: a guest gets 401 and the
// form routes them through sign-up, preserving the payload to resume.
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const topic = typeof body?.topic === 'string' ? body.topic : ''
  if (!topic.trim()) return NextResponse.json({ error: 'Please tell us what you would like coaching on.' }, { status: 400 })

  const availability = Array.isArray(body?.availability)
    ? body.availability.filter((a: unknown): a is string => typeof a === 'string').slice(0, 8)
    : []

  const result = await createCoachingRequest(member, {
    topic,
    stage: typeof body?.stage === 'string' ? body.stage : null,
    focusArea: typeof body?.focusArea === 'string' ? body.focusArea : null,
    availability,
    note: typeof body?.note === 'string' ? body.note : null,
  })

  if (!result.ok) return NextResponse.json({ error: result.error ?? 'Could not submit request' }, { status: 400 })
  return NextResponse.json({ ok: true, requestId: result.requestId, alreadyExists: result.alreadyExists ?? false })
}
