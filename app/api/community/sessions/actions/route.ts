import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { toggleAction } from '@/lib/sessions'
import { assertNotImpersonating } from '@/lib/impersonation'

// POST /api/community/sessions/actions — member checks an action done/undone.
// Body: { actionId, done }
export async function POST(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

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
