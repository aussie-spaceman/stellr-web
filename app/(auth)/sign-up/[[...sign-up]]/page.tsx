import { redirect } from 'next/navigation'
import { SignUp } from '@clerk/nextjs'
import { safeNext } from '@/lib/safe-next'
import { clerkAppearance } from '@/lib/clerk-appearance'

export const metadata = { title: 'Create Account' }

// Where a Clerk invitation link lands. Sign-up is invite-only (Clerk Restricted
// mode, 3 Nov 2026): Clerk only lets someone create an account here when the
// URL carries their invitation ticket (__clerk_ticket). Nothing in the app
// sends guests here any more; member pages bounce them to /sign-in.
//
// NEXT_PUBLIC_SIGNUPS_OPEN=false (the public-review switch) still sends a
// visitor without a ticket to the login screen, but never an invitee: their
// ticket is the only way in. The registration forms (individual/group/join-by-
// token) provision Clerk users server-side and do NOT use this page.
const SIGNUPS_OPEN = (process.env.NEXT_PUBLIC_SIGNUPS_OPEN ?? 'true') !== 'false'

// safeNext (open-redirect safety) is shared — deep review AUTH-7. See lib/safe-next.

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; __clerk_ticket?: string }>
}) {
  const sp = await searchParams
  // Carry an optional post-onboarding destination (e.g. resume a membership
  // purchase at /join?tier=…) through the hard-coded onboarding redirect.
  const next = safeNext(sp.next)
  const signInUrl = next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in'

  // Forward `next` through the gate too, so the destination survives for
  // members who sign in while self-serve signups are closed.
  if (!SIGNUPS_OPEN && !sp.__clerk_ticket) redirect(signInUrl)

  const afterUrl = next
    ? `/account/onboarding?next=${encodeURIComponent(next)}`
    : '/account/onboarding'

  return (
    <div className="flex min-h-[100svh] items-center justify-center bg-surface px-4 py-12">
      <SignUp forceRedirectUrl={afterUrl} signInUrl={signInUrl} appearance={clerkAppearance} />
    </div>
  )
}
