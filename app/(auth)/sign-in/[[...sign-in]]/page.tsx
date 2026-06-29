import { SignIn } from '@clerk/nextjs'

export const metadata = { title: 'Sign In' }

// While the site is in public review (NEXT_PUBLIC_SIGNUPS_OPEN=false), hide the
// "Don't have an account? Sign up" link that Clerk renders at the bottom of the
// sign-in card, so visitors can't create an account from the login page.
const SIGNUPS_OPEN = (process.env.NEXT_PUBLIC_SIGNUPS_OPEN ?? 'true') !== 'false'

// Only honour same-origin relative paths as a post-auth destination (open-redirect safety).
function safeNext(next: string | undefined): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const next = safeNext((await searchParams).next)
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface py-12 px-4">
      <SignIn
        forceRedirectUrl={next ?? undefined}
        appearance={
          SIGNUPS_OPEN ? undefined : { elements: { footerAction: { display: 'none' } } }
        }
      />
    </div>
  )
}
