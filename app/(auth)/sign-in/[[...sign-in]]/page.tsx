import { SignIn } from '@clerk/nextjs'
import { safeNext } from '@/lib/safe-next'
import { clerkAppearance } from '@/lib/clerk-appearance'
import { authPath } from '@/lib/auth-path'

export const metadata = { title: 'Sign In' }

// Anyone can create an account (decision 24, 3 Nov 2026), so Clerk's "Don't
// have an account? Sign up" link stays visible at the foot of this card, and it
// carries ?next so a newcomer resumes where they were after onboarding. Guests
// bounced from a member page land here (lib/auth-path) with ?next.
//
// NEXT_PUBLIC_SIGNUPS_OPEN=false is the public-review switch: it hides the link
// (the sign-up page sends anyone without an invitation back here anyway). Any
// other value, or unset, leaves sign-up open.
const SIGNUPS_OPEN = (process.env.NEXT_PUBLIC_SIGNUPS_OPEN ?? 'true') !== 'false'

// safeNext (open-redirect safety) is shared — deep review AUTH-7. See lib/safe-next.

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const next = safeNext((await searchParams).next)
  return (
    <div className="flex min-h-[100svh] items-center justify-center bg-surface px-4 py-12">
      <SignIn
        forceRedirectUrl={next ?? undefined}
        signUpUrl={authPath(next, 'sign-up')}
        appearance={
          SIGNUPS_OPEN
            ? clerkAppearance
            : { ...clerkAppearance, elements: { ...clerkAppearance.elements, footerAction: { display: 'none' } } }
        }
      />
    </div>
  )
}
