import { SectionHeading } from '@stellr/web-ui'
import { tenantFromParams } from '@/lib/tenancy/request-tenant'

// What `/` answers on a tenant host (decided in B5: lib/tenancy/tenant-surface.ts,
// tenantHostRoute). Rendered per request, so a suspended tenant drops out as soon as
// the host map does.
export const dynamic = 'force-dynamic'

export default async function TenantHomePage({ params }: { params: Promise<{ tenant: string }> }) {
  await tenantFromParams(params)
  return (
    <>
      <SectionHeading title="Follow the link you were sent" />
      <p className="mt-4 max-w-prose text-ink">
        Registration, forms and check-in each open from the link your organiser shared with you. Can’t find it? Ask
        your organiser to send it again.
      </p>
    </>
  )
}
