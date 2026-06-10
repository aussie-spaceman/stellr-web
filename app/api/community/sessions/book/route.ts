import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { bookCoaching } from '@/lib/sessions'

// POST /api/community/sessions/book
// Body: { hostId, start (ISO), durationMin?, isPaidExtra?, title? }
// Books a 1:1 coaching session with a coach (FR-COM-12).
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  if (!body.hostId || !body.start) {
    return NextResponse.json({ error: 'hostId and start required' }, { status: 400 })
  }

  const result = await bookCoaching(member, body.hostId, body.start, {
    durationMin: body.durationMin,
    isPaidExtra: body.isPaidExtra,
    title: body.title,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ id: result.sessionId })
}
