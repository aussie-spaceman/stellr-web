import { redirect } from 'next/navigation'
import { SignUp } from '@clerk/nextjs'
import { safeNext } from '@/lib/safe-next'
import { clerkAppearance } from '@/lib/clerk-appearance'
import { authPath } from '@/lib/auth-path'

export const metadata = { title: 'Create Account' }

// Self-serve account creation. Anyone can register (decision 24, 3 Nov 2026);
// the controls are by age, applied at onboarding, not by invitation. Guests
// reach this page from the sign-in card's "Sign up" link, from pages meant for
// new members (lib/auth-path 'sign-up'), from public "Join free" CTAs, and from
// Clerk invitation links (__clerk_ticket).
//
// NEXT_PUBLIC_SIGNUPS_OPEN=false (the public-review switch) sends a visitor
// without a ticket to the login screen, but never an invitee: their ticket
// still works. Unset, or any other value, keeps sign-up open. The registration
// forms (individual/group/join-by-token) provision Clerk users server-side and
// do NOT use this page.
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
  const signInUrl = authPath(next, 'sign-in')

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
