import type { Metadata } from 'next'
import TeamProfilePage from '@/app/(stellr)/(flow)/team-profile/[token]/page'
import { tenantFromParams } from '@/lib/tenancy/request-tenant'
import { requireTenantTeamProfile } from '@/lib/tenancy/tenant-records'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Team profile',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function TenantTeamProfilePage({ params }: { params: Promise<{ tenant: string; token: string }> }) {
  const tenant = await tenantFromParams(params)
  const { token } = await params
  await requireTenantTeamProfile(tenant, token)
  return <TeamProfilePage params={Promise.resolve({ token })} />
}
