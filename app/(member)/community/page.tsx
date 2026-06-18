import Link from 'next/link'
import { Suspense } from 'react'
import { Lock, MessageSquare } from 'lucide-react'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, memberMeetsTier } from '@/lib/community'
import { getSpaceUnreadCounts, getHomeFeed } from '@/lib/community-feed'
import { RegistrationSubmittedModal } from '@/components/community/RegistrationSubmittedModal'

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
        <h1 className="text-2xl font-bold text-gray-900">Spaces</h1>
        <p className="text-sm text-gray-500 mt-1">
          Welcome back{member.first_name ? `, ${member.first_name}` : ''}. Jump into a
          discussion.
        </p>
      </div>

      {feed.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Latest activity</h2>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {feed.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/community/${p.spaceSlug}/${p.id}`}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50"
                >
                  {p.unread ? (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-500" aria-label="unread" />
                  ) : (
                    <span className="h-2 w-2 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm ${p.unread ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                      {p.title}
                    </p>
                    <p className="text-xs text-gray-400">
                      {p.spaceName} · {p.authorName} · {fmtAgo(p.createdAt)}
                    </p>
                  </div>
                  {p.commentCount > 0 && (
                    <span className="flex items-center gap-1 text-xs text-gray-400">
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
          const card = (
            <div className="h-full rounded-lg border border-gray-200 bg-white p-4 transition hover:border-gray-300">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">{space.name}</h2>
                {!unlocked ? (
                  <Lock className="h-4 w-4 text-gray-400" />
                ) : (
                  unread[space.id] > 0 && (
                    <span className="rounded-full bg-indigo-500 px-2 py-0.5 text-xs font-semibold text-white">
                      {unread[space.id]} new
                    </span>
                  )
                )}
              </div>
              {space.description && (
                <p className="mt-1 text-sm text-gray-500">{space.description}</p>
              )}
              {!unlocked && (
                <p className="mt-3 text-xs font-medium text-amber-600">
                  Paid membership required —{' '}
                  <Link href="/account?tab=billing" className="underline">
                    upgrade
                  </Link>
                </p>
              )}
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
        <p className="text-sm text-gray-500">No spaces yet. Check back soon.</p>
      )}
    </div>
  )
}
