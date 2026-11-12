import type { Metadata } from 'next'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { EventSurveyQrBody } from './qr-body'

// The event-day QR code (handover §6). Never a shared survey: a signed-in
// member goes to their own invitation; anyone else gets their own link by
// email, sent only to the address it was issued to. Stellr's surveys only
// (S5 A10b); the body is shared with the tenant's page.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Event survey', robots: { index: false, follow: false }, referrer: 'no-referrer' }

export default async function EventSurveyQrPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <EventSurveyQrBody slug={slug} tenantId={STELLR_TENANT_ID} />
}
