import type { Metadata } from 'next'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { SurveyBody } from './survey-body'

// The emailed post-event survey link (handover §5 "Respond via link"). Works
// signed out. The token is personal: it is hashed and looked up, never stored.
// No tracking loads here (lib/private-routes.ts) and the page is never cached
// or indexed (next.config.mjs). Stellr's links only (S5 A10b): another tenant's
// link answers as one nobody holds. The body is shared with the tenant's page.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Stellr survey',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function SurveyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <SurveyBody token={token} tenantId={STELLR_TENANT_ID} />
}
