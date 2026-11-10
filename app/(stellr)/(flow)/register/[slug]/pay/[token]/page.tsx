import type { Metadata } from 'next'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { registrationPayBody } from './pay-body'

// The durable "pay later" page for a registration created without payment. The
// page itself is in pay-body, shared with the tenant tree.

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { robots: { index: false, follow: false } }

interface PageProps {
  params: Promise<{ slug: string; token: string }>
  searchParams: Promise<{ cancelled?: string }>
}

export default async function RegistrationPayPage({ params, searchParams }: PageProps) {
  const { slug, token } = await params
  const { cancelled } = await searchParams
  return registrationPayBody({
    slug,
    token,
    cancelled,
    // S5 A7: Stellr's registrations only. NULL is a Stellr row the backfill has not reached.
    ownedHere: (tenantId) => (tenantId ?? STELLR_TENANT_ID) === STELLR_TENANT_ID,
  })
}
