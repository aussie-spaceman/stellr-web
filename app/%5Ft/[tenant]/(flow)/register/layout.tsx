import { ClerkProvider } from '@clerk/nextjs'
import { clerkAppearance } from '@/lib/clerk-appearance'
import { requestNonce } from '@/lib/request-nonce'

// The registration forms use Clerk, as on Stellr's register layout. Indexing is off
// from the tenant layout. The nonce is the one thing read from the request here, and
// it says nothing about the tenant.
export default async function TenantRegisterLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider prefetchUI={false} appearance={clerkAppearance} nonce={await requestNonce()}>
      {children}
    </ClerkProvider>
  )
}
