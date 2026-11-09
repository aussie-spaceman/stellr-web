import type { Metadata } from 'next'
import { SigningApp } from '@/components/esign/SigningApp'

// Stellr signing: reached from the emailed signing link. Everything happens in
// the client component, which reads the key from the URL fragment. No
// tracking loads here (lib/private-routes.ts) and the response is never
// cached or indexed (next.config.mjs).

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Sign your document',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default function SignPage() {
  return <SigningApp />
}
