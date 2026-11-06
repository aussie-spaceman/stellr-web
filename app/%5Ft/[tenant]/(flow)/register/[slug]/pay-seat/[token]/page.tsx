import SeatPayPage from '@/app/(flow)/register/[slug]/pay-seat/[token]/page'
import { tenantFromParams } from '@/lib/tenancy/request-tenant'
import { requireTenantSeatPayLink } from '@/lib/tenancy/tenant-records'

export const dynamic = 'force-dynamic'

export default async function TenantSeatPayPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; slug: string; token: string }>
  searchParams: Promise<{ cancelled?: string }>
}) {
  const tenant = await tenantFromParams(params)
  const { slug, token } = await params
  await requireTenantSeatPayLink(tenant, slug, token)
  return <SeatPayPage params={Promise.resolve({ slug, token })} searchParams={searchParams} />
}
