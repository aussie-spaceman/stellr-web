import RegistrationPayPage from '@/app/(flow)/register/[slug]/pay/[token]/page'
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
  await requireTenantRegistrationPayLink(tenant, slug, token)
  return <RegistrationPayPage params={Promise.resolve({ slug, token })} searchParams={searchParams} />
}
