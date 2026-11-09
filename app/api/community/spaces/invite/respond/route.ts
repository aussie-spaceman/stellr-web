import { NextResponse } from 'next/server'
import { communityWriteBlock } from '@/lib/community'
import { getOnboardedMember } from '@/lib/onboarded-member'
import { respondToSpaceInvite } from '@/lib/spaces'
import { assertNotImpersonating } from '@/lib/impersonation'
import { auditMutation } from '@/lib/audit/route'
import { noteAudit, selfServiceEvent, type SelfServiceAudit } from '@/lib/community/self-service-audit'

// POST /api/community/spaces/invite/respond — a member accepts or declines a
// pending space invite. Body: { spaceId, action: 'accept' | 'decline' }.
// Accepting grants access (roster → active); declining dismisses the invite.
export async function POST(req: Request) {
  return audited(req, { action: 'community.space_invite.respond', table: 'community_space_members' }, () => respondToInvite(req))
}

async function respondToInvite(req: Request) {
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
  noteAudit(req, { table: 'community_spaces', targetId: spaceId, metadata: { accepted: action === 'accept' } })
  return NextResponse.json({ ok: true })
}

// The audit event for this route (docs/TENANCY-S5.md, B16): written after the response,
// never for a 4xx, ids and short codes only. lib/community/self-service-audit decides
// what is written; the call stays here because the coverage gate reads it here.
async function audited(req: Request, spec: SelfServiceAudit, run: () => Promise<Response>): Promise<Response> {
  let res: Response | undefined
  try {
    return (res = await run())
  } finally {
    await record(req, res, spec)
  }
}

async function record(req: Request, res: Response | undefined, spec: SelfServiceAudit) {
  const event = await selfServiceEvent(req, res, spec)
  if (!event) return
  await auditMutation(event, { afterResponse: true })
}
