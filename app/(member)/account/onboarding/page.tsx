import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { OnboardingForm } from '@/components/member/OnboardingForm'
import { supabaseServer } from '@/lib/supabase'

export const metadata = { title: 'Complete Your Profile' }

// Only honour same-origin relative paths (open-redirect safety).
function safeNext(next: string | undefined): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { userId } = await auth()
  const next = safeNext((await searchParams).next)
  if (!userId) redirect(next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in')

  // If member record is already complete, skip onboarding (resume `next` if present)
  const db = supabaseServer()
  const { data: member } = await db
    .from('members')
    .select('id, date_of_birth, gender, age_bracket, event_role')
    .eq('clerk_user_id', userId)
    .maybeSingle()

  if (member?.date_of_birth && member?.gender) redirect(next ?? '/home')

  const { data: tiers } = await db
    .from('membership_tiers')
    .select('*')
    .order('sort_order')

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="font-heading uppercase text-title text-brand-blue-dark">Complete your profile</h1>
        <p className="mt-2 text-sm text-brand-muted">
          Tell us a bit about yourself to get the most out of your Stellr membership.
        </p>
      </div>
      <OnboardingForm tiers={tiers ?? []} existingMember={member} next={next ?? undefined} />
    </div>
  )
}
