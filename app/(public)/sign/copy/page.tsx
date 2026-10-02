import type { Metadata } from 'next'
import { SignedCopy } from '@/components/esign/SignedCopy'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Your signed copy',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default function SignedCopyPage() {
  return <SignedCopy />
}
