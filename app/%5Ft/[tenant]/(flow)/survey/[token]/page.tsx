import type { Metadata } from 'next'
import { SurveyBody } from '@/app/(stellr)/(flow)/survey/[token]/survey-body'
import { tenantFromParams } from '@/lib/tenancy/request-tenant'
import { requireTenantSurveyInvitation } from '@/lib/tenancy/tenant-records'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Survey',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

// Stellr's page body, with this tenant's own check: Stellr's page shows Stellr's links
// only (S5 A10b).
export default async function TenantSurveyPage({ params }: { params: Promise<{ tenant: string; token: string }> }) {
  const tenant = await tenantFromParams(params)
  const { token } = await params
  await requireTenantSurveyInvitation(tenant, token)
  return <SurveyBody token={token} tenantId={tenant.tenantId} />
}
