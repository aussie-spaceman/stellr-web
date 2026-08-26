import Link from 'next/link'
import { Lock, ArrowLeft } from 'lucide-react'
import { Button } from '@stellr/web-ui'
import { ThemeDot, AccessBadge } from './badges'
import { describeAssignedTiers } from '@/lib/tiers'
import { membershipUpgradeHref } from '@/app/(public)/membership/tier-data'
import type { SpaceTheme } from '@/lib/spaces'

interface Props {
  name: string
  theme: SpaceTheme
  description: string | null
  assignedTierIds: string[]
  tierNames: Record<string, string>
  /** Blocked by an admin revocation rather than by a tier gate. */
  revoked?: boolean
}

// Locked screen (screen 07): shown when a member opens a Private space their tier
// can't join. Access is automatic by tier or admin invite — the CTA routes to the
// membership page anchored at the lowest qualifying tier (F-02).
export function LockedSpace({ name, theme, description, assignedTierIds, tierNames, revoked = false }: Props) {
  const qualifyingNames = assignedTierIds.map((id) => tierNames[id]).filter(Boolean)
  const upgradeHref = membershipUpgradeHref(qualifyingNames)
  return (
    <div className="mx-auto max-w-[560px] px-4 py-10">
      <Link
        href="/community"
        className="mb-6 inline-flex items-center gap-1 text-sm text-brand-muted-soft hover:text-brand-muted"
      >
        <ArrowLeft className="h-4 w-4" /> All spaces
      </Link>

      <div className="rounded-[18px] border border-brand-border bg-white p-8 text-center shadow-card">
        <span
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
          style={{ background: '#FBEFDD' }}
        >
          <Lock className="h-6 w-6" style={{ color: '#E0922F' }} />
        </span>

        <div className="flex items-center justify-center gap-2">
          <ThemeDot theme={theme} />
          <h1 className="font-heading text-[22px] text-brand-blue-dark">{name}</h1>
        </div>
        <div className="mt-2 flex justify-center">
          <AccessBadge type="private" />
        </div>

        {description && <p className="mt-3 text-sm text-brand-muted">{description}</p>}

        {revoked ? (
          // An admin removed them. No tier buys a way back in, so the upgrade CTA
          // is withheld rather than offering to sell something that cannot work.
          <>
            <div
              className="mt-6 rounded-[14px] p-4 text-left"
              style={{ background: '#FDECEC', border: '1px solid #F5C6C6' }}
            >
              <p className="text-xs font-subheading font-semibold uppercase tracking-[0.08em] text-red-700">
                Access removed
              </p>
              <p className="mt-1 text-sm text-brand-blue-dark">
                An administrator has removed your access to this space.
              </p>
            </div>
            <p className="mt-4 text-xs text-brand-muted-soft">
              If you think this is a mistake, contact the Stellr team.
            </p>
          </>
        ) : (
          <>
            <div
              className="mt-6 rounded-[14px] p-4 text-left"
              style={{ background: '#FBEFDD', border: '1px solid #F2DBB6' }}
            >
              <p className="text-xs font-subheading font-semibold uppercase tracking-[0.08em]" style={{ color: '#B5711F' }}>
                Requires membership tier
              </p>
              <p className="mt-1 text-sm text-brand-blue-dark">
                {describeAssignedTiers(assignedTierIds, tierNames)}
              </p>
            </div>

            <div className="mt-6">
              <Button href={upgradeHref} as={Link}>
                See membership options →
              </Button>
            </div>

            <p className="mt-4 text-xs text-brand-muted-soft">
              Access to this space is granted automatically when your membership matches one of these
              tiers, or when an admin invites you.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
