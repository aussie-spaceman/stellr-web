import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import { getSpaceForMember } from '@/lib/spaces'

const schema = z.object({ spaceSlug: z.string().min(1) })

// POST /api/community/spaces/join — a member joins an OPEN space, creating an
// active roster row so it moves from Discover → Your spaces and they're counted
// as a member. Private/secret spaces are join-by-invite/tier only, never here.
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const space = await getSpaceForMember(member, parsed.data.spaceSlug)
  if (!space || !space.access.canAccess) {
    return NextResponse.json({ error: 'No access to this space' }, { status: 403 })
  }
  if (space.access_type !== 'open') {
    return NextResponse.json({ error: 'This space is invite or tier only' }, { status: 400 })
  }

  const db = supabaseServer()
  const { error } = await db.from('community_space_members').upsert(
    { space_id: space.id, member_id: member.id, role: 'member', status: 'active', accepted_at: new Date().toISOString() },
    { onConflict: 'space_id,member_id' }
  )
  if (error) return NextResponse.json({ error: 'Could not join space' }, { status: 500 })

  return NextResponse.json({ ok: true, slug: space.slug })
}
