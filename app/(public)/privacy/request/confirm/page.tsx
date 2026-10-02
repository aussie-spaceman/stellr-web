import type { Metadata } from 'next'
import { ConfirmPrivacyRequest } from '@/components/privacy/ConfirmPrivacyRequest'

// Reached from the link in the privacy-request confirmation email. The key is
// in the URL fragment, read once by the client and removed from the address bar.

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Confirm your privacy request',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default function ConfirmPrivacyRequestPage() {
  return (
    <main className="min-h-screen bg-surface px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-2xl">
        <ConfirmPrivacyRequest />
      </div>
    </main>
  )
}
