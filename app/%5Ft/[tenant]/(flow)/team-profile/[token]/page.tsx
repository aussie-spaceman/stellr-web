import type { Metadata } from 'next'
import { TeamProfileBody } from '@/app/(stellr)/(flow)/team-profile/[token]/team-profile-body'
import { tenantFromParams } from '@/lib/tenancy/request-tenant'
import { requireTenantTeamProfile, tenantTeamProfileSession } from '@/lib/tenancy/tenant-records'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Team profile',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

// Stellr's page body, with this tenant's own session: Stellr's page shows Stellr's
// links only (S5 A10a).
export default async function TenantTeamProfilePage({ params }: { params: Promise<{ tenant: string; token: string }> }) {
  const tenant = await tenantFromParams(params)
  const { token } = await params
  await requireTenantTeamProfile(tenant, token)
  const session = await tenantTeamProfileSession(tenant, token)
  return <TeamProfileBody token={token} session={session} />
}
