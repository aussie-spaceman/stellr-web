import { SignIn } from '@clerk/nextjs'

export const metadata = { title: 'Sign In' }

// While the site is in public review (NEXT_PUBLIC_SIGNUPS_OPEN=false), hide the
// "Don't have an account? Sign up" link that Clerk renders at the bottom of the
// sign-in card, so visitors can't create an account from the login page.
const SIGNUPS_OPEN = (process.env.NEXT_PUBLIC_SIGNUPS_OPEN ?? 'true') !== 'false'

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface py-12 px-4">
      <SignIn
        appearance={
          SIGNUPS_OPEN ? undefined : { elements: { footerAction: { display: 'none' } } }
        }
      />
    </div>
  )
}
