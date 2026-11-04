import { ClerkProvider } from '@clerk/nextjs'
import { clerkAppearance } from '@/lib/clerk-appearance'
import { requestNonce } from '@/lib/request-nonce'

/** Sign-in and sign-up: Clerk's card on its own, inside the page's main landmark. */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // The nonce puts clerk-js under the CSP (lib/csp.ts).
  return (
    <ClerkProvider appearance={clerkAppearance} nonce={await requestNonce()}>
      <main id="main">{children}</main>
    </ClerkProvider>
  )
}
