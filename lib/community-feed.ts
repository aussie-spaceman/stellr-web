import { supabaseServer } from '@/lib/supabase'
import { memberMeetsTier, type CommunityMember } from '@/lib/community'

// Mark a post read for a member (idempotent upsert). Called when the post detail
// page renders. Bumps read_at so re-reading after new activity clears unread.
export async function markPostRead(memberId: string, postId: string): Promise<void> {
  const db = supabaseServer()
  await db
    .from('community_post_reads')
    .upsert(
      { member_id: memberId, post_id: postId, read_at: new Date().toISOString() },
      { onConflict: 'member_id,post_id' },
    )
}

// Unread published-post count per space for a member (server-side RPC).
export async function getSpaceUnreadCounts(memberId: string): Promise<Record<string, number>> {
  const db = supabaseServer()
  const { data } = await db.rpc('space_unread_counts', { _member_id: memberId })
  const out: Record<string, number> = {}
  for (const r of (data ?? []) as { space_id: string; unread: number }[]) {
    out[r.space_id] = Number(r.unread)
  }
  return out
}

export interface FeedPost {
  id: string
  title: string
  spaceSlug: string
  spaceName: string
  authorName: string
  createdAt: string
  commentCount: number
  unread: boolean
}

// Cross-space Home feed: most recent published posts from spaces the member can
// access, flagged unread. Excludes archived spaces and tier-locked spaces.
export async function getHomeFeed(member: CommunityMember, limit = 15): Promise<FeedPost[]> {
  const db = supabaseServer()
  const { data: spaces } = await db
    .from('community_spaces')
    .select('id, slug, name, min_tier_rank')
    .eq('is_archived', false)

  const accessible = (spaces ?? []).filter((s) =>
    memberMeetsTier(member, (s as { min_tier_rank: number }).min_tier_rank),
  ) as { id: string; slug: string; name: string }[]
  if (accessible.length === 0) return []
  const spaceById = new Map(accessible.map((s) => [s.id, s]))

  const { data: posts } = await db
    .from('community_posts')
    .select('id, space_id, title, comment_count, created_at, members:author_member_id(first_name, last_name)')
    .in('space_id', accessible.map((s) => s.id))
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(limit)

  const postRows = (posts ?? []) as {
    id: string
    space_id: string
    title: string
    comment_count: number
    created_at: string
    members: { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null
  }[]
  if (postRows.length === 0) return []

  // Resolve read state for just these posts.
  const { data: reads } = await db
    .from('community_post_reads')
    .select('post_id, read_at')
    .eq('member_id', member.id)
    .in('post_id', postRows.map((p) => p.id))
  const readAt = new Map((reads ?? []).map((r) => [r.post_id as string, r.read_at as string]))

  return postRows.map((p) => {
    const m = Array.isArray(p.members) ? p.members[0] : p.members
    const space = spaceById.get(p.space_id)!
    const r = readAt.get(p.id)
    return {
      id: p.id,
      title: p.title,
      spaceSlug: space.slug,
      spaceName: space.name,
      authorName: [m?.first_name, m?.last_name].filter(Boolean).join(' ') || 'Member',
      createdAt: p.created_at,
      commentCount: p.comment_count ?? 0,
      // Unread when never read, or created after the last read.
      unread: !r || p.created_at > r,
    }
  })
}
