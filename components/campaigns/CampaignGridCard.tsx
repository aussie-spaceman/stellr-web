import { CampaignCard, type CampaignCardVM } from './CampaignCard'

// A single Campaign card for the server-rendered /events grid. Registration now
// routes to the shared group flow (/register/[slug]/group) via a link on the
// card, so this is a thin presentational wrapper — no client modal needed.
export function CampaignGridCard({ campaign }: { campaign: CampaignCardVM }) {
  return <CampaignCard campaign={campaign} />
}
