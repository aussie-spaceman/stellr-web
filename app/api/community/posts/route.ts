import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, getSpaceBySlug, memberMeetsTier, tiptapToPlainText } from '@/lib/community'

const createPostSchema = z.object({
  spaceSlug: z.string().min(1),
  title: z.string().trim().min(1).max(300),
  bodyJson: z.unknown().optional(),
})

// POST /api/community/posts — create a post in a space (FR-COM-02).
// Any active member may post (Phase 2 decision), subject to the space tier gate.
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = createPostSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }
  const { spaceSlug, title, bodyJson } = parsed.data

  const space = await getSpaceBySlug(spaceSlug)
  if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  if (!memberMeetsTier(member, space.min_tier_rank)) {
    return NextResponse.json({ error: 'Upgrade required' }, { status: 403 })
  }

  const db = supabaseServer()
  const { data, error } = await db
    .from('community_posts')
    .insert({
      space_id: space.id,
      author_member_id: member.id,
      title,
      body_json: bodyJson ?? null,
      body_text: tiptapToPlainText(bodyJson),
    })
    .select('id')
    .single()

  if (error) {
    console.error('[community] post insert error:', error)
    return NextResponse.json({ error: 'Failed to create post' }, { status: 500 })
  }

  return NextResponse.json({ id: data.id, spaceSlug })
}
