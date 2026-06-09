import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { OnboardingForm } from '@/components/member/OnboardingForm'
import { supabaseServer } from '@/lib/supabase'

export const metadata = { title: 'Complete Your Profile' }

export default async function OnboardingPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  // If member record is already complete, skip onboarding
  const db = supabaseServer()
  const { data: member } = await db
    .from('members')
    .select('id, date_of_birth, gender, age_bracket, event_role')
    .eq('clerk_user_id', userId)
    .maybeSingle()

  if (member?.date_of_birth && member?.gender) redirect('/account')

  const { data: tiers } = await db
    .from('membership_tiers')
    .select('*')
    .order('sort_order')

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Complete your profile</h1>
        <p className="mt-2 text-sm text-gray-600">
          Tell us a bit about yourself to get the most out of your Stellr membership.
        </p>
      </div>
      <OnboardingForm tiers={tiers ?? []} existingMember={member} />
    </div>
  )
}
