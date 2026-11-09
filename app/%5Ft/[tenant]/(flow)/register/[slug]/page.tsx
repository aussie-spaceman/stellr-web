import RegisterTypePage from '@/app/(stellr)/(flow)/register/[slug]/page'
import { tenantFromParams } from '@/lib/tenancy/request-tenant'
import { requireTenantEvent } from '@/lib/tenancy/tenant-records'

export const dynamic = 'force-dynamic'

export default async function TenantRegisterTypePage({ params }: { params: Promise<{ tenant: string; slug: string }> }) {
  const tenant = await tenantFromParams(params)
  const { slug } = await params
  await requireTenantEvent(tenant, slug)
  return <RegisterTypePage params={Promise.resolve({ slug })} />
}
