import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { toggleAction } from '@/lib/sessions'

// POST /api/community/sessions/actions — member checks an action done/undone.
// Body: { actionId, done }
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { actionId, done } = await req.json().catch(() => ({}))
  if (!actionId || typeof done !== 'boolean') {
    return NextResponse.json({ error: 'actionId and done required' }, { status: 400 })
  }
  const ok = await toggleAction(actionId, member.id, done)
  if (!ok) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  return NextResponse.json({ ok: true })
}
