import { SignIn } from '@clerk/nextjs'
import { safeNext } from '@/lib/safe-next'
import { clerkAppearance } from '@/lib/clerk-appearance'

export const metadata = { title: 'Sign In' }

// Sign-up is invite-only (Clerk Restricted mode, 3 Nov 2026). A Clerk
// invitation link opens /sign-up directly with its ticket, so nobody needs the
// "Don't have an account? Sign up" link Clerk renders at the foot of this card,
// and for anyone without an invitation it leads to a dead end. It stays hidden.
// Guests bounced from a member page land here (lib/sign-in-path) with ?next.

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
        appearance={{ ...clerkAppearance, elements: { ...clerkAppearance.elements, footerAction: { display: 'none' } } }}
      />
    </div>
  )
}
