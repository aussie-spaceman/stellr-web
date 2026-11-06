import type { Metadata } from 'next'
import SurveyPage from '@/app/(flow)/survey/[token]/page'
import { tenantFromParams } from '@/lib/tenancy/request-tenant'
import { requireTenantSurveyInvitation } from '@/lib/tenancy/tenant-records'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Survey',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function TenantSurveyPage({ params }: { params: Promise<{ tenant: string; token: string }> }) {
  const tenant = await tenantFromParams(params)
  const { token } = await params
  await requireTenantSurveyInvitation(tenant, token)
  return <SurveyPage params={Promise.resolve({ token })} />
}
