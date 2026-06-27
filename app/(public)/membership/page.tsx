import type { Metadata } from 'next'
import { getTierPriceMap, formatTierPrice } from '@/lib/tier-pricing'
import { ALL_TIERS } from './tier-data'
import MembershipExplorer from './MembershipExplorer'

export const metadata: Metadata = {
  title: 'Membership',
  description:
    'A professional community for school students, college students, and educators — built around real engineering challenges. Start free. Grow as you go.',
}

export default async function MembershipPage() {
  // Prices come from membership_tiers (single source of truth) — never hard-coded.
  const prices = await getTierPriceMap()
  const priceById: Record<string, string> = {}
  for (const t of ALL_TIERS) priceById[t.id] = formatTierPrice(prices[t.name])

  return <MembershipExplorer prices={priceById} />
}
