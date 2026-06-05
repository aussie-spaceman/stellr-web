import { auth, currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase'
import { AccountProfile } from '@/components/member/AccountProfile'
import { MembershipCard } from '@/components/member/MembershipCard'
import { EventHistory } from '@/components/member/EventHistory'

export const metadata = { title: 'My Account' }

export default async function AccountPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const clerkUser = await currentUser()
  const db = supabaseServer()

  const { data: member } = await db
    .from('members')
    .select(`
      *,
      member_schools(*, schools(*)),
      member_memberships(*, membership_tiers(*)),
      member_ethnicities(*, ethnicity_options(*)),
      member_allergies(*, allergy_options(*)),
      event_participations(*)
    `)
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  // If no member record exists yet (edge case), redirect to complete onboarding
  if (!member) redirect('/account/onboarding')

  const activeMembership = member.member_memberships
    ?.filter((m: { renewal_status: string }) => m.renewal_status === 'active')
    .sort((a: { started_at: string }, b: { started_at: string }) =>
      new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
    )[0]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Account</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your Stellr membership and profile.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <AccountProfile member={member} clerkUser={clerkUser} />
          <EventHistory participations={member.event_participations ?? []} />
        </div>
        <div>
          <MembershipCard membership={activeMembership} member={member} />
        </div>
      </div>
    </div>
  )
}
