import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, memberMeetsTier, tiptapToPlainText } from '@/lib/community'

const createCommentSchema = z.object({
  postId: z.string().uuid(),
  parentCommentId: z.string().uuid().nullable().optional(),
  bodyJson: z.unknown().optional(),
})

// POST /api/community/comments — reply to a post or another comment (FR-COM-02).
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = createCommentSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }
  const { postId, parentCommentId, bodyJson } = parsed.data

  const plainText = tiptapToPlainText(bodyJson)
  if (!plainText.trim()) {
    return NextResponse.json({ error: 'Comment is empty' }, { status: 400 })
  }

  const db = supabaseServer()

  // Confirm the post exists and the member can access its space (tier gate).
  const { data: post } = await db
    .from('community_posts')
    .select('id, status, community_spaces(min_tier_rank)')
    .eq('id', postId)
    .maybeSingle()

  if (!post || post.status === 'deleted') {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }
  const spaceRel = post.community_spaces as { min_tier_rank: number } | { min_tier_rank: number }[] | null
  const minTierRank = Array.isArray(spaceRel) ? spaceRel[0]?.min_tier_rank ?? 0 : spaceRel?.min_tier_rank ?? 0
  if (!memberMeetsTier(member, minTierRank)) {
    return NextResponse.json({ error: 'Upgrade required' }, { status: 403 })
  }

  const { data: comment, error } = await db
    .from('community_comments')
    .insert({
      post_id: postId,
      parent_comment_id: parentCommentId ?? null,
      author_member_id: member.id,
      body_json: bodyJson ?? null,
      body_text: plainText,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[community] comment insert error:', error)
    return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 })
  }

  // Keep the denormalised count in sync (best-effort).
  await db.rpc('increment_post_comment_count', { p_post_id: postId }).then(
    () => {},
    async () => {
      // Fallback if the RPC isn't present: read-modify-write.
      const { data: row } = await db
        .from('community_posts')
        .select('comment_count')
        .eq('id', postId)
        .single()
      await db
        .from('community_posts')
        .update({ comment_count: (row?.comment_count ?? 0) + 1 })
        .eq('id', postId)
    }
  )

  // TODO(Phase 5): create reply/mention notifications + email via Resend.

  return NextResponse.json({ id: comment.id })
}
