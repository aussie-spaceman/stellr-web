import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, tiptapToPlainText } from '@/lib/community'
import { getSpaceAccessById, isMemberMutedInSpace } from '@/lib/spaces'
import { sendEmail, communityReplyEmail } from '@/lib/email'
import { extractMentionIds, notifyMentions } from '@/lib/mentions'
import { assertNotImpersonating } from '@/lib/impersonation'
import { runAfterResponse } from '@/lib/after-response'

const createCommentSchema = z.object({
  postId: z.guid(),
  parentCommentId: z.guid().nullable().optional(),
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
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

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

  // Confirm the post exists and the member can access its space. Gate on the
  // Open/Private/Secret access model (the same resolver the feed and post-create
  // paths use) — NOT the legacy tier-only gate, which ignored access_type and so
  // denied replies in open spaces whenever a space entitlement grant existed
  // (the "Could not reply" bug: members could view + post but not reply).
  const { data: post } = await db
    .from('community_posts')
    .select('id, status, space_id')
    .eq('id', postId)
    .maybeSingle()

  // deep review MEM-6: a post an admin has moderated is status='hidden' (not
  // 'deleted'). The old check blocked only 'deleted', so a hidden post stayed
  // commentable by direct link (mention/reply emails point straight at it).
  // Require 'published' — nobody may add a comment to a hidden or deleted post.
  if (!post || post.status !== 'published') {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }
  if (post.space_id) {
    const access = await getSpaceAccessById(member, post.space_id as string)
    if (!access || !access.canAccess) {
      return NextResponse.json({ error: 'Upgrade required' }, { status: 403 })
    }
  }
  if (post.space_id && (await isMemberMutedInSpace(post.space_id as string, member.id))) {
    return NextResponse.json({ error: 'You have been muted in this space' }, { status: 403 })
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
  // deep review QUAL-10: supabase-js resolves `{ error }` on a failed query — it
  // never rejects — so the old `.then(ok, fallback)` rejection handler was dead
  // code: the no-op fulfilled branch always ran and any RPC error was silently
  // swallowed. The RPC exists (migration 013), so there is nothing to fall back
  // to; await it and log a real error instead of hiding it.
  const { error: countError } = await db.rpc('increment_post_comment_count', { p_post_id: postId })
  if (countError) console.error('[community] increment_post_comment_count failed:', countError)

  // Notify post author on reply (FR-COM-06). Best-effort — don't fail the
  // request, but deep review QUAL-1: register it with after() so the reply
  // email is not dropped when the instance is frozen after the response.
  runAfterResponse('community', () =>
    notifyPostAuthor({ db, postId, actorMember: member, commentId: comment.id, snippedText: plainText })
  )

  // Notify any @mentioned members. Exclude the post author (they already get the
  // 'reply' notification above) and the comment author. Best-effort — after()
  // so the mention emails survive the response flush (QUAL-1).
  const mentionIds = extractMentionIds(bodyJson)
  if (mentionIds.length) {
    runAfterResponse('community', async () => {
      const { data: ctx } = await db
        .from('community_posts')
        .select('author_member_id, community_spaces(slug)')
        .eq('id', postId)
        .maybeSingle()
      const rel = ctx?.community_spaces as { slug: string } | { slug: string }[] | null
      const slug = Array.isArray(rel) ? rel[0]?.slug : rel?.slug
      await notifyMentions({
        mentionIds,
        actorMemberId: member.id,
        actorName: [member.first_name, member.last_name].filter(Boolean).join(' ') || 'A member',
        context: 'comment',
        postId,
        spaceSlug: slug ?? 'general',
        excludeIds: ctx?.author_member_id ? [ctx.author_member_id] : [],
      })
    })
  }

  return NextResponse.json({ id: comment.id })
}
