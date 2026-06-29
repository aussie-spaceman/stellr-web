import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase'
import { getTierPriceMap, formatTierPrice } from '@/lib/tier-pricing'
import { tierBySlug } from '@/app/(public)/membership/tier-data'
import { JoinCheckout } from '@/components/membership/JoinCheckout'

export const metadata = { title: 'Join Stellr' }

// Resume-safe join orchestrator. Reached from a priced membership card
// (/join?tier=catalyst). Walks the visitor through whatever step they're missing
// — sign up, complete onboarding — then presents the payment choice. Already
// signed-in, onboarded members land straight on payment.
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string }>
}) {
  const { tier: slug } = await searchParams
  const tier = slug ? tierBySlug(slug) : null

  if (!tier) redirect('/membership')
  if (tier.free) redirect('/home') // free tiers don't pay

  const selfPath = `/join?tier=${tier.id}`

  const { userId } = await auth()
  if (!userId) redirect(`/sign-up?next=${encodeURIComponent(selfPath)}`)

  const db = supabaseServer()
  const { data: member } = await db
    .from('members')
    .select('id, date_of_birth, gender')
    .eq('clerk_user_id', userId)
    .maybeSingle()

  // Not onboarded yet → finish the profile, then return here to pay.
  if (!member?.date_of_birth || !member?.gender) {
    redirect(`/account/onboarding?next=${encodeURIComponent(selfPath)}`)
  }

  const prices = await getTierPriceMap()
  const priceLabel = formatTierPrice(prices[tier.name])

  return (
    <div className="max-w-xl mx-auto">
      <JoinCheckout
        tierSlug={tier.id}
        tierName={tier.name}
        priceLabel={priceLabel}
        priceNote={tier.priceNote}
        invoiceEligible={tier.invoiceEligible}
      />
    </div>
  )
}
