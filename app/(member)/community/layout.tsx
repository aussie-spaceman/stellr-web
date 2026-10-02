import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { getCurrentMember } from '@/lib/community'
import { Toaster } from '@/components/ui/Toast'
import { getImpersonation } from '@/lib/impersonation'
import { supabaseServer } from '@/lib/supabase'
import { dispatchMembershipAgreement, membershipAgreementEnforced, membershipGate } from '@/lib/membership-agreement'

export const metadata = { title: 'Community' }

// Gated shell for the members-only Community portal (FR-COM-01).
// All chrome (logo, app nav, search, notifications, account menu) is provided
// by the parent (member) layout's AppHeader — this layout only enforces the
// gate. Middleware already bounces unauthenticated users to /sign-up; here we
// additionally ensure a member record exists (else onboarding) before
// rendering any community route.
export default async function CommunityLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-up')

  const member = await getCurrentMember()
  if (!member || member.needsOnboarding) redirect('/account/onboarding')

  // The Membership Agreement. Report-only until MEMBERSHIP_AGREEMENT_ENFORCE
  // is switched on (the owner's decision); then a member who owes it is taken
  // to their account page, where they can sign it. Never applied to an admin
  // viewing as the member.
  if (!(await getImpersonation())) {
    const db = supabaseServer()
    const gate = await membershipGate(db, member.id)
    if (gate.state !== 'clear') {
      if (!membershipAgreementEnforced()) {
        console.info(`[membership-gate] would hold member ${member.id} (${gate.state})`)
      } else {
        if (gate.state === 'not_issued') await dispatchMembershipAgreement(db, member.id).catch(() => null)
        redirect('/account?agreement=required')
      }
    }
  }

  return (
    <>
      {children}
      <Toaster />
    </>
  )
}
