import Link from 'next/link'
import { Lock } from 'lucide-react'
import { AccessBadge, SpaceIcon } from './badges'
import { JoinSpaceButton } from './JoinSpaceButton'
import { describeAssignedTiers } from '@/lib/tiers'
import { membershipUpgradeHref } from '@/app/(public)/membership/tier-data'
import type { SpaceSummary } from '@/lib/spaces'

interface Props {
  space: SpaceSummary
  /** Restricted = visible but the member's tier can't join (greyed, no CTA). */
  restricted?: boolean
  /** Joinable = an open space the member hasn't joined yet (shows a Join CTA). */
  joinable?: boolean
  /** Unread post count, when known. */
  unread?: number
  /** id → tier name, for the "Requires …" footer on restricted cards. */
  tierNames?: Record<string, string>
}

// A single space card on the directory (screen 01). Open/accessible cards link
// into the space; restricted cards route to the locked screen and carry an
// inline Upgrade link; open-but-unjoined (Discover) cards surface a Join CTA.
export function SpaceCard({ space, restricted = false, joinable = false, unread = 0, tierNames = {} }: Props) {
  const body = (
    <div
      className="flex h-full flex-col rounded-[16px] border border-brand-border bg-white p-[18px] shadow-card transition"
      style={restricted ? { opacity: 0.85 } : undefined}
    >
      <div className="flex items-start gap-3">
        <SpaceIcon theme={space.theme} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-heading text-[17px] text-brand-blue-dark">{space.name}</h3>
          <p className="text-xs text-brand-muted-soft">{space.memberCount} members</p>
        </div>
        <AccessBadge type={space.access_type} size="sm" />
      </div>

      {space.description && (
        <p className="mt-2 line-clamp-2 text-sm text-brand-muted">{space.description}</p>
      )}

      <div className="mt-auto flex items-center justify-between pt-3">
        {restricted ? (
          <span className="inline-flex flex-wrap items-center gap-1 text-xs text-brand-muted-soft">
            <Lock className="h-3 w-3" /> Requires{' '}
            {describeAssignedTiers(space.assignedTierIds, tierNames)} ·{' '}
            <Link
              href={membershipUpgradeHref(space.assignedTierIds.map((id) => tierNames[id]).filter(Boolean))}
              className="relative z-10 -m-1 p-1 font-subheading font-semibold text-brand-blue hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
            >
              Upgrade
            </Link>
          </span>
        ) : (
          <span className="text-xs text-brand-muted-soft">
            {space.channelCount} {space.channelCount === 1 ? 'channel' : 'channels'}
          </span>
        )}
        <div className="relative z-10 flex items-center gap-2">
          {!restricted && unread > 0 && (
            <span className="rounded-full bg-brand-blue px-2 py-0.5 text-[11px] font-subheading font-semibold text-white">
              {unread} new
            </span>
          )}
          {joinable && <JoinSpaceButton spaceSlug={space.slug} spaceName={space.name} />}
        </div>
      </div>
    </div>
  )

  // Joinable (open, unjoined) and restricted cards use a stretched-link overlay
  // so the whole card navigates — into the space, or to the locked screen —
  // while the Join button / Upgrade link stays independently clickable above it
  // (a <button> or <a> nested inside <a> would be invalid).
  if (joinable || restricted) {
    return (
      <div className="relative transition hover:-translate-y-0.5">
        <Link
          href={`/community/${space.slug}`}
          aria-label={space.name}
          className="absolute inset-0 z-0 rounded-[16px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
        />
        {body}
      </div>
    )
  }

  // Accessible cards are plain links into the space.
  return (
    <Link
      href={`/community/${space.slug}`}
      className="block transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
    >
      {body}
    </Link>
  )
}
