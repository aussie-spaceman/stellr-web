import Link from 'next/link'
import { Suspense } from 'react'
import { Lock, MessageSquare } from 'lucide-react'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, memberMeetsTier } from '@/lib/community'
import { getSpaceUnreadCounts, getHomeFeed, getSpaceAuthorPreviews } from '@/lib/community-feed'
import { RegistrationSubmittedModal } from '@/components/community/RegistrationSubmittedModal'
import { AvatarStack } from '@/components/ui/Avatar'
import { EmptyState } from '@/components/ui/EmptyState'

export const metadata = { title: 'Community · Spaces' }

interface SpaceRow {
  id: string
  slug: string
  name: string
  description: string | null
  min_tier_rank: number
}

// Spaces landing (FR-COM-02). Tier-gated spaces show an upgrade prompt for
// free-tier members rather than the link (FR-COM-08).
export default async function CommunityHomePage() {
  const member = await getCurrentMember()
  // Layout guarantees a member, but keep the type-narrowing explicit.
  if (!member) return null

  const db = supabaseServer()
  const [{ data: spaces }, unread, feed] = await Promise.all([
    db
      .from('community_spaces')
      .select('id, slug, name, description, min_tier_rank')
      .eq('is_archived', false)
      .order('display_order', { ascending: true }),
    getSpaceUnreadCounts(member.id),
    getHomeFeed(member),
  ])

  const spaceIds = (spaces ?? []).map((s) => (s as SpaceRow).id)
  const previews = await getSpaceAuthorPreviews(spaceIds)

  const totalNew = Object.values(unread).reduce((sum, n) => sum + (n || 0), 0)

  const fmtAgo = (iso: string) => {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  return (
    <div>
      <Suspense fallback={null}>
        <RegistrationSubmittedModal />
      </Suspense>
      <div className="mb-6">
        <p className="eyebrow flex items-center gap-2 text-brand-blue">
          <span className="h-2 w-2 rounded-full bg-brand-blue" /> Community
        </p>
        <h1 className="mt-1 font-heading uppercase text-title text-brand-blue-dark">Spaces</h1>
        <p className="mt-1 text-sm text-brand-muted-soft">
          {totalNew > 0
            ? `Your spaces have ${totalNew} new post${totalNew === 1 ? '' : 's'}.`
            : `Welcome back${member.first_name ? `, ${member.first_name}` : ''}. Jump into a discussion.`}
        </p>
      </div>

      {feed.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-subheading font-semibold uppercase tracking-wide text-brand-muted-soft">Latest activity</h2>
          <ul className="divide-y divide-brand-hairline rounded-lg border border-brand-border bg-white">
            {feed.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/community/${p.spaceSlug}/${p.id}`}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-brand-canvas"
                >
                  {p.unread ? (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-brand-blue" aria-label="unread" />
                  ) : (
                    <span className="h-2 w-2 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm ${p.unread ? 'font-semibold text-brand-blue-dark' : 'text-brand-muted'}`}>
                      {p.title}
                    </p>
                    <p className="text-xs text-brand-muted-soft">
                      {p.spaceName} · {p.authorName} · {fmtAgo(p.createdAt)}
                    </p>
                  </div>
                  {p.commentCount > 0 && (
                    <span className="flex items-center gap-1 text-xs text-brand-muted-soft">
                      <MessageSquare className="h-3.5 w-3.5" />
                      {p.commentCount}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ul className="grid gap-3 sm:grid-cols-2">
        {(spaces ?? []).map((space: SpaceRow) => {
          const unlocked = memberMeetsTier(member, space.min_tier_rank)
          const card = unlocked ? (
            <div className="h-full rounded-card border border-brand-border border-l-4 border-l-brand-blue bg-white p-4 shadow-card transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-subheading font-semibold text-brand-blue-dark">{space.name}</h2>
                {unread[space.id] > 0 && (
                  <span className="shrink-0 rounded-full bg-brand-orange-alt px-2 py-0.5 text-xs font-subheading font-semibold text-white">
                    {unread[space.id]} new
                  </span>
                )}
              </div>
              {space.description && (
                <p className="mt-1 text-sm text-brand-muted-soft">{space.description}</p>
              )}
              {previews[space.id]?.people.length > 0 && (
                <div className="mt-3">
                  <AvatarStack
                    people={previews[space.id].people}
                    extra={Math.max(0, previews[space.id].total - previews[space.id].people.length)}
                    label="members"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="h-full rounded-card border border-brand-border bg-brand-canvas p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-subheading font-semibold text-brand-muted">{space.name}</h2>
                <Lock className="h-4 w-4 shrink-0 text-brand-muted-soft" />
              </div>
              {space.description && (
                <p className="mt-1 text-sm text-brand-muted-soft">{space.description}</p>
              )}
              <Link
                href="/account?tab=billing"
                className="mt-3 inline-flex items-center gap-1 text-xs font-subheading font-semibold text-brand-gold-ink hover:underline"
              >
                <Lock className="h-3 w-3" /> Unlock with membership →
              </Link>
            </div>
          )

          return (
            <li key={space.id}>
              {unlocked ? (
                <Link href={`/community/${space.slug}`}>{card}</Link>
              ) : (
                card
              )}
            </li>
          )
        })}
      </ul>

      {(!spaces || spaces.length === 0) && (
        <EmptyState title="No spaces yet. Check back soon." />
      )}
    </div>
  )
}
