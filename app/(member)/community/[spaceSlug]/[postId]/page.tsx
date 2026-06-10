import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, getSpaceBySlug, memberMeetsTier } from '@/lib/community'
import { RichTextContent } from '@/components/community/RichTextContent'
import { ReactionBar } from '@/components/community/ReactionBar'
import { CommentForm } from '@/components/community/CommentForm'
import { Comment, type CommentNode } from '@/components/community/Comment'

type AuthorRel =
  | { first_name: string | null; last_name: string | null }
  | { first_name: string | null; last_name: string | null }[]
  | null

function nameOf(rel: AuthorRel): string {
  const m = Array.isArray(rel) ? rel[0] : rel
  if (!m) return 'Member'
  return [m.first_name, m.last_name].filter(Boolean).join(' ') || 'Member'
}

interface ReactionRow {
  target_type: string
  target_id: string
  emoji: string
  author_member_id: string
}

// Group raw reaction rows for a single target into the shape ReactionBar wants.
function groupReactions(rows: ReactionRow[], targetId: string, myMemberId: string) {
  const byEmoji = new Map<string, { count: number; reactedByMe: boolean }>()
  for (const r of rows) {
    if (r.target_id !== targetId) continue
    const cur = byEmoji.get(r.emoji) ?? { count: 0, reactedByMe: false }
    cur.count += 1
    if (r.author_member_id === myMemberId) cur.reactedByMe = true
    byEmoji.set(r.emoji, cur)
  }
  return [...byEmoji.entries()].map(([emoji, v]) => ({ emoji, ...v }))
}

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ spaceSlug: string; postId: string }>
}) {
  const { spaceSlug, postId } = await params
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const space = await getSpaceBySlug(spaceSlug)
  if (!space) notFound()
  if (!memberMeetsTier(member, space.min_tier_rank)) {
    redirect(`/community/${spaceSlug}`)
  }

  const db = supabaseServer()
  const { data: post } = await db
    .from('community_posts')
    .select('id, space_id, title, body_json, status, created_at, members:author_member_id(first_name, last_name)')
    .eq('id', postId)
    .eq('space_id', space.id)
    .maybeSingle()

  if (!post || post.status === 'deleted') notFound()

  const { data: comments } = await db
    .from('community_comments')
    .select('id, parent_comment_id, body_json, created_at, members:author_member_id(first_name, last_name)')
    .eq('post_id', postId)
    .neq('status', 'deleted')
    .order('created_at', { ascending: true })

  const commentRows = comments ?? []

  // Load all reactions for the post + its comments in one round-trip.
  const commentIds = commentRows.map((c) => c.id)
  const { data: reactionRows } = await db
    .from('community_reactions')
    .select('target_type, target_id, emoji, author_member_id')
    .or(
      `and(target_type.eq.post,target_id.eq.${postId})` +
        (commentIds.length
          ? `,and(target_type.eq.comment,target_id.in.(${commentIds.join(',')}))`
          : '')
    )
  const reactions = (reactionRows ?? []) as ReactionRow[]

  // Build the comment tree (one level of nesting).
  const nodeMap = new Map<string, CommentNode>()
  const roots: CommentNode[] = []
  for (const c of commentRows) {
    nodeMap.set(c.id, {
      id: c.id,
      postId,
      authorName: nameOf(c.members as AuthorRel),
      createdAt: c.created_at,
      bodyJson: c.body_json,
      reactions: groupReactions(reactions, c.id, member.id),
      replies: [],
    })
  }
  for (const c of commentRows) {
    const node = nodeMap.get(c.id)!
    const parent = c.parent_comment_id ? nodeMap.get(c.parent_comment_id) : null
    if (parent) parent.replies.push(node)
    else roots.push(node)
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-3 text-sm text-gray-400">
        <Link href="/community" className="hover:text-gray-600">Spaces</Link>
        <span className="mx-1">/</span>
        <Link href={`/community/${space.slug}`} className="hover:text-gray-600">{space.name}</Link>
      </div>

      <article className="rounded-lg border border-gray-200 bg-white p-5">
        <h1 className="text-xl font-bold text-gray-900">{post.title}</h1>
        <p className="mt-1 text-xs text-gray-500">
          by {nameOf(post.members as AuthorRel)} · {new Date(post.created_at).toLocaleDateString()}
        </p>
        <div className="mt-4">
          <RichTextContent doc={post.body_json} />
        </div>
        <div className="mt-4 border-t border-gray-100 pt-3">
          <ReactionBar
            targetType="post"
            targetId={post.id}
            initial={groupReactions(reactions, post.id, member.id)}
          />
        </div>
      </article>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">
          {commentRows.length} {commentRows.length === 1 ? 'comment' : 'comments'}
        </h2>

        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <CommentForm postId={post.id} placeholder="Join the conversation…" />
        </div>

        <div className="mt-4 space-y-3">
          {roots.map((node) => (
            <Comment key={node.id} node={node} />
          ))}
        </div>
      </section>
    </div>
  )
}
