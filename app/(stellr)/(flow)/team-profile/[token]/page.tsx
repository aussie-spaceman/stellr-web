import type { Metadata } from 'next'
import { supabaseServer } from '@/lib/supabase'
import { sessionByToken } from '@/lib/team-profile/store'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { TeamProfileBody, onlyTenant } from './team-profile-body'

// The emailed team profile link. Works signed out: the token is personal, and
// is hashed and looked up, never stored. Private route (lib/private-routes.ts):
// no tracking, never cached or indexed. Stellr's links only (S5 A10a): another
// tenant's link answers as one nobody holds. The body is shared with the tenant's page.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Stellr team profile',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function TeamProfilePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const session = await sessionByToken(supabaseServer(), token, { onHost: onlyTenant(STELLR_TENANT_ID) })
  return <TeamProfileBody token={token} session={session} />
}
