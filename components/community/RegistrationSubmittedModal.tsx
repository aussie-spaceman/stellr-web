'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle, X } from 'lucide-react'

// Shown when a registrant lands on /community straight after registering
// (the register routes redirect here with ?registered=1). Mirrors the standalone
// "Registration Submitted!" confirmation screen, in a modal over the portal.
export function RegistrationSubmittedModal() {
  const router = useRouter()
  const params = useSearchParams()
  const registered = params.get('registered') === '1'
  const [dismissed, setDismissed] = useState(false)

  if (!registered || dismissed) return null

  function close() {
    setDismissed(true)
    // Strip the query flags so a refresh / back-nav doesn't re-open the modal.
    router.replace('/community')
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="registration-submitted-title"
      onClick={close}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl bg-white p-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={close}
          className="absolute right-4 top-4 text-brand-muted-soft hover:text-brand-muted"
          aria-label="Close"
        >
          <X size={20} />
        </button>

        <div className="flex justify-center mb-5">
          <CheckCircle size={56} className="text-green-500" />
        </div>

        <h2 id="registration-submitted-title" className="text-center text-2xl font-bold text-brand-blue-dark mb-2">
          Registration Submitted!
        </h2>
        <p className="text-center text-brand-muted mb-6">
          You&apos;re signed in to your Stellr portal. A confirmation email is on its way.
        </p>

        <div className="rounded-xl border border-brand-border p-5 text-left space-y-3 mb-6">
          <p className="font-semibold text-brand-blue-dark">What happens next?</p>
          <ul className="space-y-2 text-sm text-brand-muted">
            <li className="flex items-start gap-2">
              <span className="text-brand-blue mt-0.5">→</span>
              <span>
                <span className="font-medium text-brand-blue-dark">Check your email to sign your DocuSign agreement</span> —
                a parental consent form (sent to your parent/guardian for under-18s) or your participation
                agreement. Your place isn&apos;t secured until it&apos;s signed.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-brand-blue mt-0.5">→</span>
              Confirmation email with your Membership ID sent to your inbox
            </li>
            <li className="flex items-start gap-2">
              <span className="text-brand-blue mt-0.5">→</span>
              Event details and schedule sent closer to the date
            </li>
          </ul>
        </div>

        <button
          type="button"
          onClick={close}
          className="btn-primary w-full py-2.5"
        >
          Explore the community
        </button>
      </div>
    </div>
  )
}
