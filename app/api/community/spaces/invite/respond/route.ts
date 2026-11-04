import { NextResponse } from 'next/server'
import { communityWriteBlock } from '@/lib/community'
import { getOnboardedMember } from '@/lib/onboarded-member'
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

  const member = await getOnboardedMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { spaceId, action } = await req.json().catch(() => ({}))
  if (!spaceId || (action !== 'accept' && action !== 'decline')) {
    return NextResponse.json({ error: 'spaceId and a valid action are required' }, { status: 400 })
  }
  // Accepting joins the Space, so the same age and consent gate as
  // /spaces/join (decision 24). Declining stays open to everyone.
  if (action === 'accept') {
    const blocked = await communityWriteBlock(member, 'join')
    if (blocked) return blocked
  }

  const ok = await respondToSpaceInvite(spaceId, member.id, action === 'accept')
  if (!ok) return NextResponse.json({ error: 'No pending invite found' }, { status: 400 })
  return NextResponse.json({ ok: true })
}
