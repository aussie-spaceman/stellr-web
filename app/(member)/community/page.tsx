import { getCurrentMember } from '@/lib/community'
import { getSpacesDirectory, type SpaceSummary } from '@/lib/spaces'
import { getSpaceUnreadCounts } from '@/lib/community-feed'
import { resolveTierMap } from '@/lib/tiers-server'
import { EmptyState } from '@/components/ui/EmptyState'
import { InviteBanner } from '@/components/community/spaces/InviteBanner'
import { SpaceCard } from '@/components/community/spaces/SpaceCard'
import { ACCESS_META } from '@/components/community/spaces/badges'
import type { SpaceAccessType } from '@/lib/spaces'

export const metadata = { title: 'Community · Spaces' }

// Spaces directory (screen 01): pending-invite banners, an access legend, and
// space cards grouped into Your spaces / Discover / Restricted. Secret spaces the
// member can't access are omitted entirely (handled in getSpacesDirectory).
export default async function CommunityHomePage() {
  const member = await getCurrentMember()
  if (!member) return null

  const [directory, unread, tierMap] = await Promise.all([
    getSpacesDirectory(member),
    getSpaceUnreadCounts(member.id),
    resolveTierMap(),
  ])

  const { yourSpaces, discover, restricted, invites } = directory

  return (
    <div className="mx-auto max-w-[1080px]">
      <header className="mb-6">
        <p className="eyebrow flex items-center gap-2 text-brand-blue">
          <span className="h-2 w-2 rounded-full bg-brand-blue" /> Community
        </p>
        <h1 className="mt-1 font-heading uppercase text-title text-brand-blue-dark">Spaces</h1>
        <p className="mt-1 text-sm text-brand-muted-soft">
          Join the conversation — discuss, share resources, and learn together across the Stellr community.
        </p>
      </header>

      {invites.length > 0 && (
        <div className="mb-6 space-y-3">
          {invites.map((inv) => (
            <InviteBanner key={inv.spaceId} invite={inv} />
          ))}
        </div>
      )}

      {/* Access legend */}
      <div className="mb-8 rounded-[16px] border border-brand-border bg-white p-[18px]">
        <p className="mb-3 text-xs font-subheading font-semibold uppercase tracking-[0.08em] text-brand-muted-soft">
          Access types
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {(Object.keys(ACCESS_META) as SpaceAccessType[]).map((t) => {
            const m = ACCESS_META[t]
            return (
              <div key={t} className="flex items-start gap-2.5">
                <span
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full"
                  style={{ background: m.color, boxShadow: `0 0 0 4px ${m.tint}` }}
                />
                <div>
                  <p className="text-sm font-subheading font-semibold text-brand-blue-dark">{m.label}</p>
                  <p className="text-xs text-brand-muted-soft">{m.blurb}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <Section title="Your spaces" hint="Spaces you can access" spaces={yourSpaces} unread={unread} />
      <Section title="Discover" hint="Open to the whole community" spaces={discover} unread={unread} joinable />
      <Section
        title="Restricted"
        hint="Visible, but your tier can't join yet"
        spaces={restricted}
        restricted
        tierNames={tierMap.nameById}
      />

      {yourSpaces.length === 0 && discover.length === 0 && restricted.length === 0 && (
        <EmptyState title="No spaces yet. Check back soon." />
      )}
    </div>
  )
}

function Section({
  title,
  hint,
  spaces,
  unread = {},
  restricted = false,
  joinable = false,
  tierNames,
}: {
  title: string
  hint: string
  spaces: SpaceSummary[]
  unread?: Record<string, number>
  restricted?: boolean
  joinable?: boolean
  tierNames?: Record<string, string>
}) {
  if (spaces.length === 0) return null
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-sm font-subheading font-semibold uppercase tracking-[0.08em] text-brand-muted">
          {title}
        </h2>
        <span className="text-xs text-brand-muted-soft">{hint}</span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {spaces.map((s) => (
          <li key={s.id}>
            <SpaceCard
              space={s}
              restricted={restricted}
              joinable={joinable}
              unread={unread[s.id] ?? 0}
              tierNames={tierNames}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
