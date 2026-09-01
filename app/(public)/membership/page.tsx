import type { Metadata } from 'next'
import { getTierPriceMap, formatTierPrice } from '@/lib/tier-pricing'
import { getMonthlyPriceMap } from '@/lib/membership-monthly'
import { ALL_TIERS, FAQS } from './tier-data'
import MembershipExplorer from './MembershipExplorer'
import { VIDEOS } from '@/lib/media-manifest'
import { buildFaqJsonLd } from '@/lib/structured-data'
import { MissionFundingNote } from '@/components/ui/MissionFundingNote'

export const metadata: Metadata = {
  alternates: { canonical: '/membership' },
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

  // Emitted here rather than inside MembershipExplorer: that's a client
  // component, and this is the same copy it renders in the FAQ accordion.
  const faqJsonLd = buildFaqJsonLd(FAQS.map((f) => ({ q: f.q, text: f.a })))

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <MembershipExplorer
        prices={priceById}
        monthly={monthlyById}
        video={VIDEOS['testimonial-noah-swingle']}
      />
      <section className="section-padding bg-white">
        <div className="container-max max-w-3xl">
          <MissionFundingNote />
        </div>
      </section>
    </>
  )
}
