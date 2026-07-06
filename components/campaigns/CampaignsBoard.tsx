import { CampaignCard, type CampaignCardVM } from './CampaignCard'

interface Props {
  campaigns: CampaignCardVM[]
}

// A grid of Campaign cards. Registration routes to the shared group flow
// (/register/[slug]/group) via a link on each card, so no shared modal is needed.
export function CampaignsBoard({ campaigns }: Props) {
  return (
    <div className="grid gap-[18px] [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
      {campaigns.map((c) => (
        <CampaignCard key={c.slug} campaign={c} />
      ))}
    </div>
  )
}
