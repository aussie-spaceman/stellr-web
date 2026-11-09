import type { Metadata } from 'next'
import { EmailChangeApp } from '@/components/esign/EmailChangeApp'

// The one-time link in a bounce notice: a parent fixes the student's address, a
// student suggests their parent's (lib/esign/email-changes.ts). The key is in
// the URL fragment, read by the client component. A private route
// (lib/private-routes.ts: /sign/…): no tracking, never cached or indexed.

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Update an email address',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default function EmailChangePage() {
  return <EmailChangeApp />
}
