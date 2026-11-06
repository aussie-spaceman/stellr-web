import type { Metadata } from 'next'
import { SignedCopy } from '@/components/esign/SignedCopy'
import { tenantFromParams } from '@/lib/tenancy/request-tenant'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Your signed copy',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

// No record to check here, for the same reason as ../page.tsx.
export default async function TenantSignedCopyPage({ params }: { params: Promise<{ tenant: string }> }) {
  await tenantFromParams(params)
  return <SignedCopy />
}
