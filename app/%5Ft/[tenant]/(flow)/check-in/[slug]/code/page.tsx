import CheckInCodePage from '@/app/(stellr)/(flow)/check-in/[slug]/code/page'
import { tenantFromParams } from '@/lib/tenancy/request-tenant'
import { requireTenantEvent } from '@/lib/tenancy/tenant-records'

export const metadata = { title: 'Check-in code', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function TenantCheckInCodePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; slug: string }>
  searchParams: Promise<{ c?: string }>
}) {
  const tenant = await tenantFromParams(params)
  const { slug } = await params
  await requireTenantEvent(tenant, slug)
  return <CheckInCodePage params={Promise.resolve({ slug })} searchParams={searchParams} />
}
