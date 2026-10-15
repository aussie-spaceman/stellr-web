import { SignIn } from '@clerk/nextjs'
import { safeNext } from '@/lib/safe-next'
import { clerkAppearance } from '@/lib/clerk-appearance'

export const metadata = { title: 'Sign In' }

// While the site is in public review (NEXT_PUBLIC_SIGNUPS_OPEN=false), hide the
// "Don't have an account? Sign up" link that Clerk renders at the bottom of the
// sign-in card, so visitors can't create an account from the login page.
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
        signUpUrl={next ? `/sign-up?next=${encodeURIComponent(next)}` : '/sign-up'}
        appearance={
          SIGNUPS_OPEN
            ? clerkAppearance
            : { ...clerkAppearance, elements: { ...clerkAppearance.elements, footerAction: { display: 'none' } } }
        }
      />
    </div>
  )
}
