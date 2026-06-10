import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, memberMeetsTier, tiptapToPlainText } from '@/lib/community'
import { sendEmail, communityReplyEmail } from '@/lib/email'

const createCommentSchema = z.object({
  postId: z.string().uuid(),
  parentCommentId: z.string().uuid().nullable().optional(),
  bodyJson: z.unknown().optional(),
})

async function notifyPostAuthor({
  db,
  postId,
  actorMember,
  commentId,
  snippedText,
}: {
  db: ReturnType<typeof supabaseServer>
  postId: string
  actorMember: { id: string; first_name: string | null; last_name: string | null }
  commentId: string
  snippedText: string
}) {
  const { data: post } = await db
    .from('community_posts')
    .select('title, author_member_id, community_spaces(slug), members:author_member_id(first_name, email)')
    .eq('id', postId)
    .maybeSingle()

  if (!post?.author_member_id || post.author_member_id === actorMember.id) return

  const spaceSlug = Array.isArray(post.community_spaces)
    ? post.community_spaces[0]?.slug
    : (post.community_spaces as { slug: string } | null)?.slug ?? 'general'

  const postUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.stellreducation.org'}/community/${spaceSlug}/${postId}`
  const actorName = [actorMember.first_name, actorMember.last_name].filter(Boolean).join(' ') || 'A member'
  const recipient = Array.isArray(post.members) ? post.members[0] : post.members as { first_name: string | null; email: string | null } | null

  await db.from('community_notifications').insert({
    recipient_member_id: post.author_member_id,
    actor_member_id: actorMember.id,
    type: 'reply',
    reference_type: 'post',
    reference_id: postId,
    body: snippedText.slice(0, 120),
  })

  if (recipient?.email) {
    const { subject, html, text } = communityReplyEmail({
      recipientFirstName: recipient.first_name ?? 'there',
      actorName,
      postTitle: post.title,
      postUrl,
    })
    await sendEmail({ to: recipient.email, subject, html, text })
    await db
      .from('community_notifications')
      .update({ emailed_at: new Date().toISOString() })
      .eq('reference_id', postId)
      .eq('recipient_member_id', post.author_member_id)
      .eq('type', 'reply')
      .eq('reference_type', 'post')
      .is('emailed_at', null)
  }
}

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

  // Notify post author on reply (FR-COM-06). Best-effort — don't fail the request.
  notifyPostAuthor({ db, postId, actorMember: member, commentId: comment.id, snippedText: plainText }).catch(
    (e) => console.error('[community] notification error:', e)
  )

  return NextResponse.json({ id: comment.id })
}
