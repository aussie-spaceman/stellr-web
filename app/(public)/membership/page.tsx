import type { Metadata } from 'next'
import { getTierPriceMap, formatTierPrice } from '@/lib/tier-pricing'
import { getMonthlyPriceMap } from '@/lib/membership-monthly'
import { ALL_TIERS } from './tier-data'
import MembershipExplorer from './MembershipExplorer'
import { PageMedia } from '@/components/sections/PageMedia'
import { PHOTOS, VIDEOS, QUOTES } from '@/lib/media-manifest'

export const metadata: Metadata = {
  title: 'Membership',
  description:
    'A professional community for school students, college students, and educators — built around real engineering challenges. Start free. Grow as you go.',
}

export default async function MembershipPage() {
  // Prices come from membership_tiers (single source of truth) — never hard-coded.
  const [prices, monthly] = await Promise.all([getTierPriceMap(), getMonthlyPriceMap()])
  const priceById: Record<string, string> = {}
  const monthlyById: Record<string, string> = {}
  for (const t of ALL_TIERS) {
    priceById[t.id] = formatTierPrice(prices[t.name])
    if (monthly[t.name]) monthlyById[t.id] = monthly[t.name]
  }

  return (
    <>
      <MembershipExplorer prices={priceById} monthly={monthlyById} />
      <PageMedia
        heading="A world that didn’t seem possible"
        photos={[PHOTOS['membership-hero']]}
        videos={[VIDEOS['testimonial-noah-swingle']]}
        quotes={[QUOTES['2023-student']]}
      />
    </>
  )
}
