import { getRegistrationPrefill } from '@/lib/registration-prefill'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { groupJoinBody } from './join-body'

interface PageProps {
  params: Promise<{ slug: string; token: string }>
}

export default async function GroupJoinPage({ params }: PageProps) {
  const { slug, token } = await params
  return groupJoinBody({
    slug,
    token,
    loadPrefill: () => getRegistrationPrefill().catch(() => null),
    // S5 A7: Stellr's links only. NULL is a Stellr row the backfill has not reached.
    ownedHere: (tenantId) => (tenantId ?? STELLR_TENANT_ID) === STELLR_TENANT_ID,
  })
}
