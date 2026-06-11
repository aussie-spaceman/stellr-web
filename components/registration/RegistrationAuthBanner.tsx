'use client'

import { SignOutButton } from '@clerk/nextjs'
import { CheckCircle2 } from 'lucide-react'

// Update #2 — login recognition banner shown on the registration screens.
// Server resolves the member (so name/email come from our DB, not just Clerk),
// and passes the result here. When signed in we confirm the identity and offer
// a sign-out escape hatch; otherwise we invite sign-in to pre-fill.
export function RegistrationAuthBanner({
  signedIn,
  name,
  email,
  signInUrl,
  returnUrl,
}: {
  signedIn: boolean
  name?: string
  email?: string
  signInUrl: string
  returnUrl: string
}) {
  if (signedIn) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span>
          Registering as <strong>{name || email}</strong>
          {name && email ? ` (${email})` : ''}. We&apos;ve pre-filled your details.
        </span>
        <span className="text-green-700/70">
          Not you?{' '}
          <SignOutButton redirectUrl={returnUrl}>
            <button className="underline hover:text-green-900">Sign out</button>
          </SignOutButton>
        </span>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
      Already have a Stellr account?{' '}
      <a href={signInUrl} className="font-medium text-brand-blue hover:underline">
        Sign in to pre-fill your details
      </a>
      .
    </div>
  )
}
