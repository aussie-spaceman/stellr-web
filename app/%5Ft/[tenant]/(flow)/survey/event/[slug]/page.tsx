import type { Metadata } from 'next'
import { EventSurveyQrBody } from '@/app/(stellr)/(flow)/survey/event/[slug]/qr-body'
import { tenantFromParams } from '@/lib/tenancy/request-tenant'
import { requireTenantEvent } from '@/lib/tenancy/tenant-records'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Event survey', robots: { index: false, follow: false }, referrer: 'no-referrer' }

// Stellr's page body, with this tenant's own check: Stellr's page shows Stellr's surveys
// only (S5 A10b).
export default async function TenantEventSurveyQrPage({ params }: { params: Promise<{ tenant: string; slug: string }> }) {
  const tenant = await tenantFromParams(params)
  const { slug } = await params
  await requireTenantEvent(tenant, slug)
  return <EventSurveyQrBody slug={slug} tenantId={tenant.tenantId} />
}
