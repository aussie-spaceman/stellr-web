import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import { clerkAppearance } from '@/lib/clerk-appearance'
import { requestNonce } from '@/lib/request-nonce'

/**
 * Registration is a transactional funnel, not content: the type chooser, the
 * individual/group forms, the invite-token join page and the confirmation
 * screen (which carries an `?id=` reference in the URL) have no standalone
 * informational value and shouldn't compete with /events/[slug] in search or
 * answer-engine indexes. Children inherit this unless they set their own.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: true },
}

// The registration forms use Clerk (sign-in state, the join link's sign-in),
// so registration gets its own provider; the rest of the public site has none.
// Every registration page already renders per request (each reads the
// session), so reading the CSP nonce here costs nothing extra.
//
// prefetchUI={false} keeps Clerk's prebuilt UI out of these pages, and an in-app
// navigation keeps the same Clerk instance. So a next/link from here to a page
// that renders that UI (sign-in, sign-up, or any member page's avatar) crashes it:
// "Clerk was not loaded with Ui components". Those links must be plain <a>, which
// loads the page afresh. test/register-links-to-clerk-ui.test.ts holds this.
export default async function RegisterLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider prefetchUI={false} appearance={clerkAppearance} nonce={await requestNonce()}>
      {children}
    </ClerkProvider>
  )
}
