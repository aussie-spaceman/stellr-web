import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { respondToSpaceInvite } from '@/lib/spaces'
import { assertNotImpersonating } from '@/lib/impersonation'

// POST /api/community/spaces/invite/respond — a member accepts or declines a
// pending space invite. Body: { spaceId, action: 'accept' | 'decline' }.
// Accepting grants access (roster → active); declining dismisses the invite.
export async function POST(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

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
