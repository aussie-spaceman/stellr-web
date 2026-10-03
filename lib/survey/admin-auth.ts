/**
 * Survey data is admin-only (handover A3: the analysis view and exports).
 * Event managers run their event's survey but do not export responses.
 */
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { isAdminClaims } from '@/lib/admin-auth'

export async function requireSurveyAdmin(): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const { userId, sessionClaims } = await auth()
  if (!userId) return { ok: false, response: NextResponse.json({ error: 'Unauthorised' }, { status: 401 }) }
  if (!isAdminClaims(sessionClaims)) return { ok: false, response: NextResponse.json({ error: 'Admins only' }, { status: 403 }) }
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
