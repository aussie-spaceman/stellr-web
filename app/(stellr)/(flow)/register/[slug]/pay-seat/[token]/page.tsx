import type { Metadata } from 'next'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { seatPayBody } from './pay-seat-body'

// The durable "pay your seat" page for a "members pay individually" participant
// (deep review PAY-8). The page itself is in pay-seat-body, shared with the tenant
// tree.

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { robots: { index: false, follow: false } }

interface PageProps {
  params: Promise<{ slug: string; token: string }>
  searchParams: Promise<{ cancelled?: string }>
}

export default async function SeatPayPage({ params, searchParams }: PageProps) {
  const { slug, token } = await params
  const { cancelled } = await searchParams
  return seatPayBody({
    slug,
    token,
    cancelled,
    // S5 A7: Stellr's seats only. NULL is a Stellr row the backfill has not reached.
    ownedHere: (tenantId) => (tenantId ?? STELLR_TENANT_ID) === STELLR_TENANT_ID,
  })
}
