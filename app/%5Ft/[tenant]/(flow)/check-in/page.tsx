import { redirect } from 'next/navigation'
import { checkInNotOpen } from '@/app/(stellr)/(flow)/check-in/not-open'
import { pickBannerEvent, todayUtc } from '@/lib/check-in-banner'
import { tenantFromParams } from '@/lib/tenancy/request-tenant'
import { tenantOpenCheckIns } from '@/lib/tenancy/tenant-records'

export const metadata = { title: 'Event Check-In', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

// The banner address on a tenant host goes only to this tenant's open check-in. The
// rewrite is on the host, so the redirect names the host's own /check-in path. A 307,
// as on Stellr's page, because a phone caches a permanent redirect.
export default async function TenantCheckInBannerPage({ params }: { params: Promise<{ tenant: string }> }) {
  const tenant = await tenantFromParams(params)
  const target = pickBannerEvent(await tenantOpenCheckIns(tenant), todayUtc())
  if (target?.token) redirect(`/check-in/${target.slug}?t=${encodeURIComponent(target.token)}`)
  return checkInNotOpen()
}
