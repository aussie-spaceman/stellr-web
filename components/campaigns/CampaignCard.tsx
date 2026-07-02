import Link from 'next/link'
import { Orbit, Environment, Event } from '@stellr/icons'
import { Button } from '@stellr/web-ui'
import type { CampaignCardData } from '@/lib/campaigns'

export type CampaignCardVM = CampaignCardData

const themeChip: Record<'space' | 'enviro', string> = {
  space: 'bg-space-violet-chip text-space-violet-text',
  enviro: 'bg-enviro-green-chip text-enviro-green-text',
}

// Amber-coded Campaign card for the public /events board. Amber top border + the
// uppercase "CAMPAIGN" label + "No payment" chip distinguish it from blue Events.
export function CampaignCard({
  campaign,
  onRegister,
}: {
  campaign: CampaignCardVM
  onRegister: (c: CampaignCardVM) => void
}) {
  const ThemeIcon = campaign.theme === 'enviro' ? Environment : Orbit
  return (
    <article className="flex flex-col overflow-hidden rounded-ds-card border border-line border-t-4 border-t-pathway-amber bg-white shadow-card-lift">
      <div className="flex flex-1 flex-col p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className={`inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-xs font-semibold ${themeChip[campaign.theme]}`}>
            <ThemeIcon className="h-3.5 w-3.5" /> {campaign.themeLabel}
          </span>
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-pathway-amber">Campaign</span>
        </div>

        <h3 className="font-heading text-[19px] font-bold leading-snug text-ink">{campaign.title}</h3>
        <p className="mt-1 text-ds-meta text-content-muted">
          {[campaign.seasonLabel, campaign.gradeLevel].filter(Boolean).join(' · ')}
        </p>
        {campaign.tagline && (
          <p className="mt-2 line-clamp-2 text-sm text-content-secondary">{campaign.tagline}</p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-surface px-2.5 py-1 text-xs text-content-secondary">
            <Event className="h-3.5 w-3.5" /> Proposal due {campaign.deadlineLabel}
          </span>
          <span className="rounded-pill bg-pathway-amber-bg px-2.5 py-1 text-xs font-semibold text-pathway-amber">
            No payment
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 px-5 pb-5">
        <Link href={`/events/${campaign.slug}`} className="text-sm font-semibold text-primary hover:text-primary-deep">
          View details
        </Link>
        {campaign.registered ? (
          <span className="rounded-pill bg-enviro-green-bg px-3 py-1 text-xs font-semibold text-enviro-green-text">
            Registered
          </span>
        ) : (
          <Button variant="primary" onClick={() => onRegister(campaign)} className="!px-4 !py-2 text-sm">
            Register group →
          </Button>
        )}
      </div>
    </article>
  )
}
