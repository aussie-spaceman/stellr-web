import type { Metadata } from 'next'
import { SigningApp } from '@/components/esign/SigningApp'
import { tenantFromParams } from '@/lib/tenancy/request-tenant'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Sign your document',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

// No record to check here: the page reads nothing, and the key is in the URL fragment,
// which the server never sees. The tenant check on the envelope belongs to the APIs
// the signing app calls (A11, and C6's tenant-host ratchet until then).
export default async function TenantSignPage({ params }: { params: Promise<{ tenant: string }> }) {
  await tenantFromParams(params)
  return <SigningApp />
}
