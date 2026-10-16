import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import { clerkAppearance } from '@/lib/clerk-appearance'

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
export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider prefetchUI={false} appearance={clerkAppearance}>
      {children}
    </ClerkProvider>
  )
}
