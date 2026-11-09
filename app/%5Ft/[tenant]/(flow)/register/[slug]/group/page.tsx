import { groupRegistrationBody } from '@/app/(stellr)/(flow)/register/[slug]/group/group-body'
import { tenantFromParams } from '@/lib/tenancy/request-tenant'
import { requireTenantEvent } from '@/lib/tenancy/tenant-records'

export const dynamic = 'force-dynamic'

// No prefill: it reads the member's latest roster row, from any organiser.
export default async function TenantGroupRegistrationPage({ params }: { params: Promise<{ tenant: string; slug: string }> }) {
  const tenant = await tenantFromParams(params)
  const { slug } = await params
  await requireTenantEvent(tenant, slug)
  return groupRegistrationBody({ slug })
}
