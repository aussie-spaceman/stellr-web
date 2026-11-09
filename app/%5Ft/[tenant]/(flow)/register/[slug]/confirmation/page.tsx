import { confirmationBody, type ConfirmationQuery } from '@/app/(stellr)/(flow)/register/[slug]/confirmation/confirmation-body'
import { tenantFromParams } from '@/lib/tenancy/request-tenant'
import { googleSheetParam, requireTenantEvent } from '@/lib/tenancy/tenant-records'

export const dynamic = 'force-dynamic'

export default async function TenantConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; slug: string }>
  searchParams: Promise<ConfirmationQuery>
}) {
  const tenant = await tenantFromParams(params)
  const { slug } = await params
  await requireTenantEvent(tenant, slug)
  const query = await searchParams
  return confirmationBody({ slug, query: { ...query, spreadsheet: googleSheetParam(query.spreadsheet) } })
}
