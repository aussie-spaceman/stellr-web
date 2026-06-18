import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { MessageSquare, Pin, Megaphone } from 'lucide-react'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, getSpaceBySlug, memberMeetsTier } from '@/lib/community'
import { getSpaceChannel } from '@/lib/sessions'
import { NewPostForm } from '@/components/community/NewPostForm'
import { ChatPanel } from '@/components/community/ChatPanel'
import { Avatar } from '@/components/ui/Avatar'

interface PostListRow {
  id: string
  title: string
  is_announcement: boolean
  is_pinned: boolean
  comment_count: number
  created_at: string
  members: { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null
}

function authorName(rel: PostListRow['members']): string {
  const m = Array.isArray(rel) ? rel[0] : rel
  if (!m) return 'Unknown'
  return [m.first_name, m.last_name].filter(Boolean).join(' ') || 'Member'
}

export default async function SpaceFeedPage({
  params,
}: {
  params: Promise<{ spaceSlug: string }>
}) {
  const { spaceSlug } = await params
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const space = await getSpaceBySlug(spaceSlug)
  if (!space) notFound()

  // Tier gate (FR-COM-08): block the feed for members below the required tier.
  if (!memberMeetsTier(member, space.min_tier_rank)) {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-brand-orange bg-brand-orange/5 p-6 text-center">
        <h1 className="text-lg font-semibold text-brand-blue-dark">{space.name} is for paid members</h1>
        <p className="mt-2 text-sm text-brand-muted">
          Upgrade your membership to join this space.
        </p>
        <Link
          href="/account?tab=billing"
          className="mt-4 inline-block rounded-md bg-brand-blue-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-blue-dark"
        >
          View membership options
        </Link>
      </div>
    )
  }

  // Live discussion channel for this space (Phase 4 — chat on Spaces, D7).
  const chatChannelId = await getSpaceChannel(space.id)

  const db = supabaseServer()
  const { data: posts } = await db
    .from('community_posts')
    .select('id, title, is_announcement, is_pinned, comment_count, created_at, members:author_member_id(first_name, last_name)')
    .eq('space_id', space.id)
    .eq('status', 'published')
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false })

  return (
    <div>
      <div className="mb-2 text-sm text-brand-muted-soft">
        <Link href="/community" className="hover:text-brand-muted">Spaces</Link>
        <span className="mx-1">/</span>
        <span className="text-brand-muted">{space.name}</span>
      </div>
      <h1 className="font-heading uppercase text-title text-brand-blue-dark">{space.name}</h1>
      {space.description && <p className="mt-1 text-sm text-brand-muted-soft">{space.description}</p>}

      <div className="mt-5">
        <ChatPanel
          channelId={chatChannelId}
          selfMemberId={member.id}
          selfName={[member.first_name, member.last_name].filter(Boolean).join(' ') || undefined}
          title={`${space.name} chat`}
        />
      </div>

      <div className="mt-5">
        <NewPostForm spaceSlug={space.slug} />
      </div>

      <ul className="mt-4 space-y-2">
        {(posts ?? []).map((post: PostListRow) => (
          <li key={post.id}>
            <Link
              href={`/community/${space.slug}/${post.id}`}
              className="block rounded-lg border border-brand-border bg-white p-4 transition hover:border-brand-border"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {post.is_announcement && <Megaphone className="h-4 w-4 shrink-0 text-brand-blue" />}
                    {post.is_pinned && <Pin className="h-4 w-4 shrink-0 text-brand-muted-soft" />}
                    <h2 className="truncate font-semibold text-brand-blue-dark">{post.title}</h2>
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-brand-muted-soft">
                    <Avatar id={authorName(post.members)} name={authorName(post.members)} size="sm" ring={false} />
                    by {authorName(post.members)}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1 text-xs text-brand-muted-soft">
                  <MessageSquare className="h-3.5 w-3.5" />
                  {post.comment_count}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {(!posts || posts.length === 0) && (
        <p className="mt-6 text-center text-sm text-brand-muted-soft">
          No posts yet. Be the first to start a discussion.
        </p>
      )}
    </div>
  )
}
