import { SignUp } from '@clerk/nextjs'

export const metadata = { title: 'Create Account' }

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface py-12 px-4">
      <SignUp forceRedirectUrl="/account/onboarding" />
    </div>
  )
}
