import type { Metadata } from 'next'
import EventSurveyQrPage from '@/app/(flow)/survey/event/[slug]/page'
import { tenantFromParams } from '@/lib/tenancy/request-tenant'
import { requireTenantEvent } from '@/lib/tenancy/tenant-records'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Event survey', robots: { index: false, follow: false }, referrer: 'no-referrer' }

export default async function TenantEventSurveyQrPage({ params }: { params: Promise<{ tenant: string; slug: string }> }) {
  const tenant = await tenantFromParams(params)
  const { slug } = await params
  await requireTenantEvent(tenant, slug)
  return <EventSurveyQrPage params={Promise.resolve({ slug })} />
}
