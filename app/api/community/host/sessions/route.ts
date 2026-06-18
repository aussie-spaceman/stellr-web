import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { getHostCaps, hostRespond, setHostNotes, addActions, scheduleMentoring } from '@/lib/sessions'

// Host session management (FR-COM-11/12). One endpoint, switched on `action`:
//   respond  → accept/decline/cancel/complete a session
//   notes    → save post-session notes
//   actions  → set close-out actions for a member
//   schedule → schedule a mentoring session for a cohort
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const caps = await getHostCaps(member.id)
  if (!caps.canCoach && !caps.canMentor) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const b = await req.json().catch(() => ({}))

  switch (b.action) {
    case 'respond': {
      if (!b.sessionId || !['declined', 'cancelled', 'completed'].includes(b.status)) {
        return NextResponse.json({ error: 'sessionId and valid status required' }, { status: 400 })
      }
      const ok = await hostRespond(b.sessionId, member.id, b.status)
      return ok
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: 'Not allowed' }, { status: 403 })
    }
    case 'notes': {
      if (!b.sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
      const ok = await setHostNotes(b.sessionId, member.id, b.notes ?? '')
      return ok
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: 'Not allowed' }, { status: 403 })
    }
    case 'actions': {
      const items = Array.isArray(b.actions) ? b.actions : Array.isArray(b.titles) ? b.titles : null
      if (!b.sessionId || !b.memberId || !items) {
        return NextResponse.json({ error: 'sessionId, memberId, actions[]|titles[] required' }, { status: 400 })
      }
      const ok = await addActions(b.sessionId, member.id, b.memberId, items)
      return ok
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: 'Not allowed' }, { status: 403 })
    }
    case 'schedule': {
      if (!caps.canMentor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      if (!b.cohortId || !b.start) {
        return NextResponse.json({ error: 'cohortId and start required' }, { status: 400 })
      }
      const result = await scheduleMentoring(member.id, b.cohortId, b.start, {
        durationMin: b.durationMin,
        title: b.title,
      })
      return result.ok
        ? NextResponse.json({ id: result.sessionId })
        : NextResponse.json({ error: result.error }, { status: 400 })
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}
