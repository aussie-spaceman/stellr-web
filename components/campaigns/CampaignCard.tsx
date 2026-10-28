import Link from 'next/link'
import { Orbit, Environment } from '@stellr/icons'
import { CampaignCardAction } from './CampaignMemberAware'
import { CardPills } from '@/components/ui/CardPills'
import { CoverImage } from '@/components/ui/CoverImage'
import type { CampaignCardData } from '@/lib/campaigns'

export type CampaignCardVM = CampaignCardData

// Campaign card for the unified /events board. Mirrors EventCard's structure
// (image header, badge row, meta, footer CTA) so both card kinds sit in one
// grid; the amber "Campaign" pill distinguishes it from Events. Registration
// routes to the shared group flow (/register/[slug]/group), same as Events.
export function CampaignCard({ campaign }: { campaign: CampaignCardVM }) {
  const ThemeIcon = campaign.theme === 'enviro' ? Environment : Orbit

  return (
    <article className="bg-white rounded-xl shadow-xs border border-line-light overflow-hidden hover:shadow-md transition-shadow flex flex-col">
      {/* Image header — same footprint as EventCard */}
      <div className="relative h-44 bg-gradient-to-br from-brand-blue-dark to-blue-900 flex items-center justify-center">
        {campaign.image ? (
          <CoverImage image={campaign.image} alt={campaign.title} />
        ) : (
          <ThemeIcon className="h-10 w-10 text-blue-300 opacity-60" />
        )}
      </div>

      <div className="p-5 flex flex-col flex-1">
        {/* Standardised three-pill row (Campaign · Grade · Theme) */}
        <CardPills
          kind="campaign"
          gradeLevel={campaign.gradeLevel}
          theme={campaign.theme}
          className="mb-3"
        />

        <h3 className="font-bold text-brand-blue-dark mb-1 leading-snug">{campaign.title}</h3>

        <p className="text-sm text-content-muted">
          {[campaign.seasonLabel, 'Async — runs at your school'].filter(Boolean).join(' · ')}
        </p>
        {campaign.deadlineLabel && (
          <p className="text-sm text-content-muted">Proposal due {campaign.deadlineLabel}</p>
        )}

        {campaign.tagline && (
          <p className="mt-2 text-sm text-brand-grey-dark line-clamp-2">{campaign.tagline}</p>
        )}

        <div className="mt-auto pt-4 flex items-center justify-between gap-3">
          <Link
            href={`/events/${campaign.slug}`}
            className="text-sm font-semibold text-brand-blue hover:underline"
          >
            View details
          </Link>
          {/* Registered state fills in in the browser, so /events can be cached. */}
          <CampaignCardAction slug={campaign.slug} registered={campaign.registered} />
        </div>
      </div>
    </article>
  )
}
