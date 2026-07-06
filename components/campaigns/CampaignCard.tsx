import Link from 'next/link'
import Image from 'next/image'
import { Orbit, Environment } from '@stellr/icons'
import { Button } from '@stellr/web-ui'
import { CardPills } from '@/components/ui/CardPills'
import type { CampaignCardData } from '@/lib/campaigns'

export type CampaignCardVM = CampaignCardData

// Campaign card for the unified /events board. Mirrors EventCard's structure
// (image header, badge row, meta, footer CTA) so both card kinds sit in one
// grid; the amber "Campaign" pill distinguishes it from Events. Registration
// routes to the shared group flow (/register/[slug]/group), same as Events.
export function CampaignCard({ campaign }: { campaign: CampaignCardVM }) {
  const ThemeIcon = campaign.theme === 'enviro' ? Environment : Orbit

  return (
    <article className="bg-white rounded-xl shadow-sm border border-line-light overflow-hidden hover:shadow-md transition-shadow flex flex-col">
      {/* Image header — same footprint as EventCard */}
      <div className="relative h-44 bg-gradient-to-br from-brand-blue-dark to-blue-900 flex items-center justify-center">
        {campaign.imageUrl ? (
          <Image src={campaign.imageUrl} alt={campaign.title} fill className="object-cover" />
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

        <p className="text-sm text-brand-grey-mid">
          {[campaign.seasonLabel, 'Async — runs at your school'].filter(Boolean).join(' · ')}
        </p>
        {campaign.deadlineLabel && (
          <p className="text-sm text-brand-grey-mid">Proposal due {campaign.deadlineLabel}</p>
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
          {campaign.registered ? (
            <span className="rounded-pill bg-enviro-green-bg px-3 py-1 text-xs font-semibold text-enviro-green-text">
              Registered
            </span>
          ) : (
            <Button href={`/register/${campaign.slug}/group`} variant="primary" className="!px-4 !py-2 text-sm">
              Register group →
            </Button>
          )}
        </div>
      </div>
    </article>
  )
}
