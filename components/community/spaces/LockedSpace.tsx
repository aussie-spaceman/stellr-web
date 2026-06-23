import Link from 'next/link'
import { Lock, ArrowLeft } from 'lucide-react'
import { ThemeDot, AccessBadge } from './badges'
import { describeAssignedTiers } from '@/lib/tiers'
import type { SpaceTheme } from '@/lib/spaces'

interface Props {
  name: string
  theme: SpaceTheme
  description: string | null
  assignedTierIds: string[]
  tierNames: Record<string, string>
}

// Locked screen (screen 07): shown when a member opens a Private space their tier
// can't join. No join/upgrade CTA — access is automatic by tier or admin invite.
export function LockedSpace({ name, theme, description, assignedTierIds, tierNames }: Props) {
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

        <p className="mt-4 text-xs text-brand-muted-soft">
          Access to this space is granted automatically when your membership matches one of these
          tiers, or when an admin invites you.
        </p>
      </div>
    </div>
  )
}
