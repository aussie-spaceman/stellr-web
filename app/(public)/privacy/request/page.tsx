import type { Metadata } from 'next'
import { PrivacyRequestForm } from '@/components/privacy/PrivacyRequestForm'

// The form behind the Privacy Policy's "Your rights": ask to see, correct or
// delete information, or withdraw a consent, for yourself or your child. No
// tracking loads here (lib/private-routes.ts): people describe their families.

export const metadata: Metadata = {
  title: 'Make a privacy request',
  robots: { index: false, follow: true },
  referrer: 'no-referrer',
}

export default function PrivacyRequestPage() {
  return (
    <main className="min-h-screen bg-surface px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-2xl space-y-6">
        <header>
          <p className="font-subheading text-xs font-semibold uppercase tracking-[0.14em] text-primary-deep">Your privacy</p>
          <h1 className="mt-1 font-display text-3xl font-bold text-ink">Make a privacy request</h1>
          <p className="mt-2 text-content-body">
            Ask us to show you the information we hold about you or your child, to correct it, to delete it, or to
            withdraw a consent you gave, such as for photos or for messages to your child. We email you a link to
            confirm the request came from you, and answer within 30 days of that.
          </p>
          <p className="mt-2 text-sm text-content-muted">
            Some records we have to keep for a time even after a deletion request, such as signed consent forms. Our{' '}
            <a className="text-primary-deep underline" href="/privacy">Privacy Policy</a> explains what, and why.
          </p>
        </header>
        <PrivacyRequestForm />
      </div>
    </main>
  )
}
