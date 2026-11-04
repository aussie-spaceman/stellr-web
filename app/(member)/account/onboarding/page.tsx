import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { OnboardingForm, PendingConsentPanel, type SelectedTier } from '@/components/member/OnboardingForm'
import { getPendingConsent, minorSelfSignupEnabled, settlePendingConsent } from '@/lib/pending-consent'
import { supabaseServer } from '@/lib/supabase'
import { tierBySlug } from '@/app/(public)/membership/tier-data'
import { impersonatedMemberId } from '@/lib/impersonation'
import { safeNext } from '@/lib/safe-next'

export const metadata = { title: 'Complete Your Profile' }

// safeNext (open-redirect safety) is shared — deep review AUTH-7. See lib/safe-next.

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
  // Volunteer program signup (public /volunteer page → sign-up or sign-in → here).
  const volunteerFlow = sp.role === 'volunteer'
  if (!userId) {
    const selfPath = volunteerFlow ? '/account/onboarding?role=volunteer' : next
    redirect(selfPath ? `/sign-in?next=${encodeURIComponent(selfPath)}` : '/sign-in')
  }

  // If member record is already complete, skip onboarding (resume `next` if present)
  // Admin view-as: resolve the member being viewed, not the admin.
  const viewAsId = await impersonatedMemberId()
  const db = supabaseServer()
  const memberQuery = db.from('members').select('id, date_of_birth, gender, age_bracket, event_role')
  const { data: member } = viewAsId
    ? await memberQuery.eq('id', viewAsId).maybeSingle()
    : await memberQuery.eq('clerk_user_id', userId).maybeSingle()

  // A self-registered minor whose parent or guardian has not consented yet
  // (decision 24) sees who the form went to, with a resend, rather than the
  // form again. Read before the "already complete" redirect: a 13–17-year-old
  // has a complete profile and comes here to resend or correct the address.
  const pending = member && !viewAsId ? await getPendingConsent(db, member.id) : null
  if (pending && !(await settlePendingConsent(db, member!.id))) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="font-heading text-ds-h2 text-ink">Almost there</h1>
        </div>
        <PendingConsentPanel
          kind={pending.band === 'child' ? 'parent' : 'guardian'}
          guardianEmail={pending.guardian_email}
          next={next ?? undefined}
        />
      </div>
    )
  }

  if (member?.date_of_birth && member?.gender) redirect(next ?? '/home')

  const selectedTier = tierFromNext(next)

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="font-heading text-ds-h2 text-ink">
          {volunteerFlow ? 'Join as a volunteer' : 'Complete your profile'}
        </h1>
        <p className="mt-2 text-sm text-content-body">
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
        minorSelfSignup={minorSelfSignupEnabled()}
      />
    </div>
  )
}
