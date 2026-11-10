import { registrationPayBody } from '@/app/(stellr)/(flow)/register/[slug]/pay/[token]/pay-body'
import { tenantFromParams } from '@/lib/tenancy/request-tenant'
import { requireTenantRegistrationPayLink } from '@/lib/tenancy/tenant-records'

export const dynamic = 'force-dynamic'

export default async function TenantRegistrationPayPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; slug: string; token: string }>
  searchParams: Promise<{ cancelled?: string }>
}) {
  const tenant = await tenantFromParams(params)
  const { slug, token } = await params
  const { cancelled } = await searchParams
  await requireTenantRegistrationPayLink(tenant, slug, token)
  return registrationPayBody({ slug, token, cancelled })
}
