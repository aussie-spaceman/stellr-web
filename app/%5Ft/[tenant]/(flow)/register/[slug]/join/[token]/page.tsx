import { groupJoinBody } from '@/app/(flow)/register/[slug]/join/[token]/join-body'
import { tenantFromParams } from '@/lib/tenancy/request-tenant'
import { requireTenantJoinLink } from '@/lib/tenancy/tenant-records'

export const dynamic = 'force-dynamic'

// No prefill: it reads the member's latest roster row, from any organiser.
export default async function TenantGroupJoinPage({ params }: { params: Promise<{ tenant: string; slug: string; token: string }> }) {
  const tenant = await tenantFromParams(params)
  const { slug, token } = await params
  await requireTenantJoinLink(tenant, slug, token)
  return groupJoinBody({ slug, token })
}
