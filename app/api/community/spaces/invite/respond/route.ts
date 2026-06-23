import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { respondToSpaceInvite } from '@/lib/spaces'

// POST /api/community/spaces/invite/respond — a member accepts or declines a
// pending space invite. Body: { spaceId, action: 'accept' | 'decline' }.
// Accepting grants access (roster → active); declining dismisses the invite.
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { spaceId, action } = await req.json().catch(() => ({}))
  if (!spaceId || (action !== 'accept' && action !== 'decline')) {
    return NextResponse.json({ error: 'spaceId and a valid action are required' }, { status: 400 })
  }

  const ok = await respondToSpaceInvite(spaceId, member.id, action === 'accept')
  if (!ok) return NextResponse.json({ error: 'No pending invite found' }, { status: 400 })
  return NextResponse.json({ ok: true })
}
