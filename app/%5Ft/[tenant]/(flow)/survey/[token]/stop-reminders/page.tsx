import type { Metadata } from 'next'
import StopRemindersPage from '@/app/(stellr)/(flow)/survey/[token]/stop-reminders/page'
import { tenantFromParams } from '@/lib/tenancy/request-tenant'
import { requireTenantSurveyInvitation } from '@/lib/tenancy/tenant-records'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Stop survey reminders',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function TenantStopRemindersPage({ params }: { params: Promise<{ tenant: string; token: string }> }) {
  const tenant = await tenantFromParams(params)
  const { token } = await params
  await requireTenantSurveyInvitation(tenant, token)
  return <StopRemindersPage params={Promise.resolve({ token })} />
}
