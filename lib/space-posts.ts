import { supabaseServer } from '@/lib/supabase'
import { signedDownloadUrl } from '@/lib/community'

// Hydrated channel-feed data (author identity + tier + space role + reactions +
// threaded replies) for the in-space channel feed (screen 02). Used by both the
// server-rendered page and the realtime refetch endpoint.

export interface FeedReaction {
  emoji: string
  count: number
  reactedByMe: boolean
}

export interface FeedReply {
  id: string
  authorId: string | null
  authorName: string
  tierName: string | null
  role: 'admin' | 'moderator' | 'member' | null
  bodyText: string
  createdAt: string
  reactions: FeedReaction[]
}

export interface FeedAttachment {
  resourceId: string
  name: string
  fileType: string | null
  /** Short-lived signed URL for inline rendering when the attachment is an image. */
  previewUrl: string | null
}

export interface FeedPost {
  id: string
  authorId: string | null
  authorName: string
  tierName: string | null
  role: 'admin' | 'moderator' | 'member' | null
  title: string | null
  bodyText: string
  createdAt: string
  isPinned: boolean
  isAnnouncement: boolean
  attachment: FeedAttachment | null
  reactions: FeedReaction[]
  replies: FeedReply[]
}

function nameOf(m: { first_name: string | null; last_name: string | null } | null): string {
  if (!m) return 'Member'
  return [m.first_name, m.last_name].filter(Boolean).join(' ') || 'Member'
}

/** Group raw reaction rows into per-target toggle state for `selfId`. */
function groupReactions(
  rows: { target_id: string; emoji: string; author_member_id: string }[],
  selfId: string
): Map<string, FeedReaction[]> {
  const byTarget = new Map<string, Map<string, { count: number; mine: boolean }>>()
  for (const r of rows) {
    const m = byTarget.get(r.target_id) ?? new Map()
    const cur = m.get(r.emoji) ?? { count: 0, mine: false }
    cur.count += 1
    if (r.author_member_id === selfId) cur.mine = true
    m.set(r.emoji, cur)
    byTarget.set(r.target_id, m)
  }
  const out = new Map<string, FeedReaction[]>()
  for (const [tid, m] of byTarget) {
    out.set(
      tid,
      [...m.entries()].map(([emoji, v]) => ({ emoji, count: v.count, reactedByMe: v.mine }))
    )
  }
  return out
}

/**
 * Load a channel's posts fully hydrated for `viewerId`. Returns posts newest-first
 * with pinned posts on top, each with author tier/role, reactions, and replies.
 */
export async function getChannelPosts(
  channelId: string,
  spaceId: string,
  viewerId: string
): Promise<FeedPost[]> {
  const db = supabaseServer()

  const { data: postRows } = await db
    .from('community_posts')
    .select(
      'id, author_member_id, title, body_text, is_announcement, is_pinned, created_at, members:author_member_id(first_name, last_name)'
    )
    .eq('channel_id', channelId)
    .eq('status', 'published')
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(100)

  const posts = (postRows ?? []) as Array<{
    id: string
    author_member_id: string | null
    title: string | null
    body_text: string | null
    is_announcement: boolean
    is_pinned: boolean
    created_at: string
    members: { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null
  }>
  if (posts.length === 0) return []

  const postIds = posts.map((p) => p.id)

  // Replies for these posts.
  const { data: replyRows } = await db
    .from('community_comments')
    .select(
      'id, post_id, author_member_id, body_text, created_at, members:author_member_id(first_name, last_name)'
    )
    .in('post_id', postIds)
    .eq('status', 'published')
    .order('created_at', { ascending: true })

  const replies = (replyRows ?? []) as Array<{
    id: string
    post_id: string
    author_member_id: string | null
    body_text: string | null
    created_at: string
    members: { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null
  }>
  const replyIds = replies.map((r) => r.id)

  // Attachments saved from these posts (from_chat resources linked back).
  const { data: attachRows } = await db
    .from('community_resources')
    .select('id, title, file_type, storage_path, source_post_id')
    .in('source_post_id', postIds)

  const attachByPost = new Map<string, FeedAttachment>()
  await Promise.all(
    ((attachRows ?? []) as Array<{ id: string; title: string; file_type: string | null; storage_path: string | null; source_post_id: string | null }>).map(
      async (a) => {
        if (!a.source_post_id) return
        // Image attachments render inline: mint a short-lived signed URL. The feed
        // is force-dynamic (and the realtime refetch re-runs this), so it stays fresh.
        const isImage = a.file_type === 'IMG'
        const previewUrl = isImage && a.storage_path ? await signedDownloadUrl(a.storage_path) : null
        attachByPost.set(a.source_post_id, { resourceId: a.id, name: a.title, fileType: a.file_type, previewUrl })
      }
    )
  )

  // Reactions for posts + replies.
  const { data: reactionRows } = await db
    .from('community_reactions')
    .select('target_type, target_id, emoji, author_member_id')
    .or(
      `and(target_type.eq.post,target_id.in.(${postIds.join(',')}))` +
        (replyIds.length ? `,and(target_type.eq.comment,target_id.in.(${replyIds.join(',')}))` : '')
    )

  const reactions = (reactionRows ?? []) as Array<{ target_type: string; target_id: string; emoji: string; author_member_id: string }>
  const reactByTarget = groupReactions(reactions, viewerId)

  // Author tier names + space roles (batched across all post + reply authors).
  const authorIds = [
    ...new Set([
      ...posts.map((p) => p.author_member_id),
      ...replies.map((r) => r.author_member_id),
    ].filter((id): id is string => !!id)),
  ]
  const { tierByAuthor, roleByAuthor } = await resolveAuthorMeta(authorIds, spaceId)

  const repliesByPost = new Map<string, FeedReply[]>()
  for (const r of replies) {
    const arr = repliesByPost.get(r.post_id) ?? []
    arr.push({
      id: r.id,
      authorId: r.author_member_id,
      authorName: nameOf(Array.isArray(r.members) ? r.members[0] ?? null : r.members),
      tierName: r.author_member_id ? tierByAuthor.get(r.author_member_id) ?? null : null,
      role: r.author_member_id ? roleByAuthor.get(r.author_member_id) ?? null : null,
      bodyText: r.body_text ?? '',
      createdAt: r.created_at,
      reactions: reactByTarget.get(r.id) ?? [],
    })
    repliesByPost.set(r.post_id, arr)
  }

  return posts.map((p) => ({
    id: p.id,
    authorId: p.author_member_id,
    authorName: nameOf(Array.isArray(p.members) ? p.members[0] ?? null : p.members),
    tierName: p.author_member_id ? tierByAuthor.get(p.author_member_id) ?? null : null,
    role: p.author_member_id ? roleByAuthor.get(p.author_member_id) ?? null : null,
    title: p.title || null,
    bodyText: p.body_text ?? '',
    createdAt: p.created_at,
    isPinned: p.is_pinned,
    isAnnouncement: p.is_announcement,
    attachment: attachByPost.get(p.id) ?? null,
    reactions: reactByTarget.get(p.id) ?? [],
    replies: repliesByPost.get(p.id) ?? [],
  }))
}

/** Batch-resolve each author's primary active tier name + role within a space. */
async function resolveAuthorMeta(
  authorIds: string[],
  spaceId: string
): Promise<{ tierByAuthor: Map<string, string>; roleByAuthor: Map<string, 'admin' | 'moderator' | 'member'> }> {
  const tierByAuthor = new Map<string, string>()
  const roleByAuthor = new Map<string, 'admin' | 'moderator' | 'member'>()
  if (authorIds.length === 0) return { tierByAuthor, roleByAuthor }

  const db = supabaseServer()
  const today = new Date().toISOString().split('T')[0]

  const [{ data: memberships }, { data: roles }] = await Promise.all([
    db
      .from('member_memberships')
      .select('member_id, started_at, expires_at, renewal_status, membership_tiers(name)')
      .in('member_id', authorIds)
      .eq('renewal_status', 'active'),
    db
      .from('community_space_members')
      .select('member_id, role')
      .eq('space_id', spaceId)
      .eq('status', 'active')
      .in('member_id', authorIds),
  ])

  // Pick the most-recently-started active, unexpired membership per author.
  const best = new Map<string, { started: number; name: string }>()
  for (const m of (memberships ?? []) as Array<{
    member_id: string
    started_at: string
    expires_at: string | null
    membership_tiers: { name: string } | { name: string }[] | null
  }>) {
    if (m.expires_at && m.expires_at < today) continue
    const tier = Array.isArray(m.membership_tiers) ? m.membership_tiers[0] : m.membership_tiers
    if (!tier?.name) continue
    const started = new Date(m.started_at).getTime()
    const cur = best.get(m.member_id)
    if (!cur || started > cur.started) best.set(m.member_id, { started, name: tier.name })
  }
  for (const [id, v] of best) tierByAuthor.set(id, v.name)

  for (const r of (roles ?? []) as Array<{ member_id: string; role: 'admin' | 'moderator' | 'member' }>) {
    roleByAuthor.set(r.member_id, r.role)
  }

  return { tierByAuthor, roleByAuthor }
}
