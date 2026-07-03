import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { OnboardingForm, type SelectedTier } from '@/components/member/OnboardingForm'
import { supabaseServer } from '@/lib/supabase'
import { tierBySlug } from '@/app/(public)/membership/tier-data'

export const metadata = { title: 'Complete Your Profile' }

// Only honour same-origin relative paths (open-redirect safety).
function safeNext(next: string | undefined): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null
}

// The join orchestrator sends members here as `?next=/join?tier=<slug>`. We read
// that tier so onboarding can be driven by the *purchase*, not a self-reported
// role: student tiers skip the role question, teacher tiers show adult roles only.
function tierFromNext(next: string | null): SelectedTier | null {
  if (!next) return null
  const qs = next.split('?')[1]
  if (!qs) return null
  const slug = new URLSearchParams(qs).get('tier')
  if (!slug) return null
  const t = tierBySlug(slug)
  return t ? { slug: t.id, name: t.name, bracket: t.bracket } : null
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; role?: string }>
}) {
  const { userId } = await auth()
  const sp = await searchParams
  const next = safeNext(sp.next)
  // Volunteer program signup (public /volunteer page → /sign-up → here).
  const volunteerFlow = sp.role === 'volunteer'
  if (!userId) {
    const selfPath = volunteerFlow ? '/account/onboarding?role=volunteer' : next
    redirect(selfPath ? `/sign-in?next=${encodeURIComponent(selfPath)}` : '/sign-in')
  }

  // If member record is already complete, skip onboarding (resume `next` if present)
  const db = supabaseServer()
  const { data: member } = await db
    .from('members')
    .select('id, date_of_birth, gender, age_bracket, event_role')
    .eq('clerk_user_id', userId)
    .maybeSingle()

  if (member?.date_of_birth && member?.gender) redirect(next ?? '/home')

  const selectedTier = tierFromNext(next)

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="font-heading uppercase text-title text-brand-blue-dark">
          {volunteerFlow ? 'Join as a volunteer' : 'Complete your profile'}
        </h1>
        <p className="mt-2 text-sm text-brand-muted">
          {volunteerFlow
            ? 'Tell us a bit about yourself. We’ll then send your Volunteer Agreement and set up your volunteer training.'
            : 'Tell us a bit about yourself to get the most out of your Stellr membership.'}
        </p>
      </div>
      <OnboardingForm
        existingMember={member}
        next={next ?? undefined}
        selectedTier={selectedTier}
        volunteerFlow={volunteerFlow}
      />
    </div>
  )
}
