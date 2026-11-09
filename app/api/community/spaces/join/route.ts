import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { communityWriteBlock } from '@/lib/community'
import { getOnboardedMember } from '@/lib/onboarded-member'
import { getSpaceForMember } from '@/lib/spaces'
import { assertNotImpersonating } from '@/lib/impersonation'
import { auditMutation } from '@/lib/audit/route'
import { noteAudit, selfServiceEvent, type SelfServiceAudit } from '@/lib/community/self-service-audit'

const schema = z.object({ spaceSlug: z.string().min(1) })

// POST /api/community/spaces/join — a member joins an OPEN space, creating an
// active roster row so it moves from Discover → Your spaces and they're counted
// as a member. Private/secret spaces are join-by-invite/tier only, never here.
export async function POST(req: Request) {
  return audited(req, { action: 'community.space.join', table: 'community_space_members' }, () => joinSpace(req))
}

async function joinSpace(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getOnboardedMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  // Decision 24: age and guardian-consent restrictions (lib/community).
  const restricted = await communityWriteBlock(member, 'join')
  if (restricted) return restricted

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const space = await getSpaceForMember(member, parsed.data.spaceSlug)
  if (!space || !space.access.canAccess) {
    return NextResponse.json({ error: 'No access to this space' }, { status: 403 })
  }
  if (space.access_type !== 'open') {
    return NextResponse.json({ error: 'This space is invite or tier only' }, { status: 400 })
  }

  noteAudit(req, { table: 'community_spaces', targetId: space.id })
  const db = supabaseServer()
  const { error } = await db.from('community_space_members').upsert(
    { space_id: space.id, member_id: member.id, role: 'member', status: 'active', accepted_at: new Date().toISOString() },
    { onConflict: 'space_id,member_id' }
  )
  if (error) return NextResponse.json({ error: 'Could not join space' }, { status: 500 })

  return NextResponse.json({ ok: true, slug: space.slug })
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
