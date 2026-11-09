import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase'
import { getTierPriceMap, formatTierPrice } from '@/lib/tier-pricing'
import { getMonthlyPriceMap } from '@/lib/membership-monthly'
import { tierBySlug } from '@/app/(stellr)/(public)/membership/tier-data'
import { JoinCheckout } from '@/components/membership/JoinCheckout'
import { impersonatedMemberId } from '@/lib/impersonation'
import { authPath } from '@/lib/auth-path'

export const metadata = { title: 'Join Stellr' }

// Resume-safe join orchestrator. Reached from a priced membership card
// (/join?tier=catalyst). Walks the visitor through whatever step they're missing
// — sign up (or sign in), complete onboarding — then presents the payment choice. Already
// signed-in, onboarded members land straight on payment.
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; interval?: string }>
}) {
  const sp = await searchParams
  const slug = sp.tier
  const tier = slug ? tierBySlug(slug) : null

  if (!tier) redirect('/membership')
  if (tier.free) redirect('/home') // free tiers don't pay

  const wantMonthly = sp.interval === 'monthly'
  const selfPath = `/join?tier=${tier.id}${wantMonthly ? '&interval=monthly' : ''}`

  const { userId } = await auth()
  // A guest here is usually new, so they create an account (the sign-up card
  // links back to sign-in) and come back here after onboarding.
  if (!userId) redirect(authPath(selfPath, 'sign-up'))

  // Admin view-as: resolve the member being viewed, not the admin.
  const viewAsId = await impersonatedMemberId()
  const db = supabaseServer()
  const memberQuery = db.from('members').select('id, date_of_birth, gender')
  const { data: member } = viewAsId
    ? await memberQuery.eq('id', viewAsId).maybeSingle()
    : await memberQuery.eq('clerk_user_id', userId).maybeSingle()

  // Not onboarded yet → finish the profile, then return here to pay.
  if (!member?.date_of_birth || !member?.gender) {
    redirect(`/account/onboarding?next=${encodeURIComponent(selfPath)}`)
  }

  const [prices, monthly] = await Promise.all([getTierPriceMap(), getMonthlyPriceMap()])
  // Monthly only applies to the school/college paid tiers; invoice-eligible
  // (teacher) tiers are always annual, so the two never conflict.
  const useMonthly = wantMonthly && !!monthly[tier.name]
  const priceLabel = useMonthly ? monthly[tier.name] : formatTierPrice(prices[tier.name])
  const priceNote = useMonthly ? 'per month' : tier.priceNote

  return (
    <div className="max-w-xl mx-auto">
      <JoinCheckout
        tierSlug={tier.id}
        tierName={tier.name}
        priceLabel={priceLabel}
        priceNote={priceNote}
        billingInterval={useMonthly ? 'monthly' : 'annual'}
        invoiceEligible={tier.invoiceEligible}
      />
    </div>
  )
}
