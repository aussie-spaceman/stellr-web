import Link from 'next/link'
import { Lock } from 'lucide-react'
import { AccessBadge, SpaceIcon } from './badges'
import { describeAssignedTiers } from '@/lib/tiers'
import type { SpaceSummary } from '@/lib/spaces'

interface Props {
  space: SpaceSummary
  /** Restricted = visible but the member's tier can't join (greyed, no CTA). */
  restricted?: boolean
  /** Unread post count, when known. */
  unread?: number
  /** id → tier name, for the "Requires …" footer on restricted cards. */
  tierNames?: Record<string, string>
}

// A single space card on the directory (screen 01). Open/accessible cards link
// into the space; restricted cards are dimmed and route to the locked screen.
export function SpaceCard({ space, restricted = false, unread = 0, tierNames = {} }: Props) {
  const body = (
    <div
      className="flex h-full flex-col rounded-[16px] border border-brand-border bg-white p-[18px] shadow-card transition"
      style={restricted ? { opacity: 0.62 } : undefined}
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
          <span className="inline-flex items-center gap-1 text-xs text-brand-muted-soft">
            <Lock className="h-3 w-3" /> Requires {describeAssignedTiers(space.assignedTierIds, tierNames)}
          </span>
        ) : (
          <span className="text-xs text-brand-muted-soft">
            {space.channelCount} {space.channelCount === 1 ? 'channel' : 'channels'}
          </span>
        )}
        {!restricted && unread > 0 && (
          <span className="rounded-full bg-brand-blue px-2 py-0.5 text-[11px] font-subheading font-semibold text-white">
            {unread} new
          </span>
        )}
      </div>
    </div>
  )

  // Both accessible and restricted cards are links — restricted routes to the
  // locked screen (which explains the tier requirement), per the handoff.
  return (
    <Link
      href={`/community/${space.slug}`}
      className="block transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
    >
      {body}
    </Link>
  )
}
