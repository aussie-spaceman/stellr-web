/**
 * Survey data is admin-only (handover A3: the analysis view and exports).
 * Event managers run their event's survey but do not export responses.
 */
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { hasCapability, type Capability } from '@/lib/authz'

export async function requireSurveyAdmin(cap: Capability = 'competitions:write'): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  // Surveys are part of Competitions: Staff runs and reads them; exports need 'export' (Staff has it).
  const { userId } = await auth()
  if (!userId) return { ok: false, response: NextResponse.json({ error: 'Unauthorised' }, { status: 401 }) }
  if (!(await hasCapability(cap))) return { ok: false, response: NextResponse.json({ error: 'Admins only' }, { status: 403 }) }
  return { ok: true, userId }
}

export function filterFrom(url: string) {
  const sp = new URL(url).searchParams
  const year = Number(sp.get('year'))
  return {
    eventSlug: sp.get('event') || null,
    year: Number.isInteger(year) && year > 2000 ? year : null,
    surveyKey: sp.get('survey') || null,
  }
}
