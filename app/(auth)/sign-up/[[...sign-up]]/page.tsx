import { redirect } from 'next/navigation'
import { SignUp } from '@clerk/nextjs'

export const metadata = { title: 'Create Account' }

// Single chokepoint for self-serve account creation. While the site is in
// public review (NEXT_PUBLIC_SIGNUPS_OPEN=false), this page redirects to the
// login screen, so no marketing CTA, navbar link, or direct URL can create an
// account. The registration forms (individual/group/join-by-token) provision
// Clerk users server-side and do NOT use this page, so they are unaffected.
const SIGNUPS_OPEN = (process.env.NEXT_PUBLIC_SIGNUPS_OPEN ?? 'true') !== 'false'

// Only honour same-origin relative paths as a post-auth destination (open-redirect safety).
function safeNext(next: string | undefined): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  if (!SIGNUPS_OPEN) redirect('/sign-in')

  // Carry an optional post-onboarding destination (e.g. resume a membership
  // purchase at /join?tier=…) through the hard-coded onboarding redirect.
  const next = safeNext((await searchParams).next)
  const afterUrl = next
    ? `/account/onboarding?next=${encodeURIComponent(next)}`
    : '/account/onboarding'

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface py-12 px-4">
      <SignUp forceRedirectUrl={afterUrl} />
    </div>
  )
}
