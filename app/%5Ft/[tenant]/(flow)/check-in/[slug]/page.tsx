import CheckInPage from '@/app/(flow)/check-in/[slug]/page'
import { tenantFromParams } from '@/lib/tenancy/request-tenant'
import { requireTenantEvent } from '@/lib/tenancy/tenant-records'

export const metadata = { title: 'Event Check-In', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function TenantCheckInPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; slug: string }>
  searchParams: Promise<{ t?: string }>
}) {
  const tenant = await tenantFromParams(params)
  const { slug } = await params
  await requireTenantEvent(tenant, slug)
  return <CheckInPage params={Promise.resolve({ slug })} searchParams={searchParams} />
}
