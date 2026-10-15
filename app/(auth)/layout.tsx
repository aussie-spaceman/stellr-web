import { ClerkProvider } from '@clerk/nextjs'
import { clerkAppearance } from '@/lib/clerk-appearance'

/** Sign-in and sign-up: Clerk's card on its own, inside the page's main landmark. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider appearance={clerkAppearance}>
      <main id="main">{children}</main>
    </ClerkProvider>
  )
}
