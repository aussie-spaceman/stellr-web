import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Membership',
  description: 'Find your place in the Stellr community. Explorer (free), Pathfinder, Scholar, and more.',
}

export default function MembershipPage() {
  return (
    <div className="section-padding container-max">
      <h1 className="text-4xl font-bold text-brand-navy">Membership</h1>
      <p className="mt-3 text-brand-grey-dark">Membership tiers + pricing — coming in step 9.</p>
    </div>
  )
}
