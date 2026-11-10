import { seatPayBody } from '@/app/(stellr)/(flow)/register/[slug]/pay-seat/[token]/pay-seat-body'
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
  const { cancelled } = await searchParams
  await requireTenantSeatPayLink(tenant, slug, token)
  return seatPayBody({ slug, token, cancelled })
}
