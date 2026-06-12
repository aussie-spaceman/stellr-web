import Link from 'next/link'
import { Suspense } from 'react'
import { Lock } from 'lucide-react'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, memberMeetsTier } from '@/lib/community'
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
  const { data: spaces } = await db
    .from('community_spaces')
    .select('id, slug, name, description, min_tier_rank')
    .eq('is_archived', false)
    .order('display_order', { ascending: true })

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

      <ul className="grid gap-3 sm:grid-cols-2">
        {(spaces ?? []).map((space: SpaceRow) => {
          const unlocked = memberMeetsTier(member, space.min_tier_rank)
          const card = (
            <div className="h-full rounded-lg border border-gray-200 bg-white p-4 transition hover:border-gray-300">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">{space.name}</h2>
                {!unlocked && <Lock className="h-4 w-4 text-gray-400" />}
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
