/**
 * Shared request handling for the respondent API: resolve the caller's survey
 * session from a token (signed out allowed) or an invitation id (signed-in
 * member), and refuse anything they may not do.
 *
 * A token link of another host's survey answers as one nobody holds (S5 A10b): the
 * host check comes straight after the read, before the signed-in member is compared
 * and before anything in the body is looked at, so another host's link cannot be told
 * from a missing one. A Stellr link held by the wrong Stellr member keeps its 403.
 */
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, getSignedInMember } from '@/lib/community'
import { assertNotImpersonating } from '@/lib/impersonation'
import { rateLimit } from '@/lib/rate-limit-async'
import { requestTenant } from '@/lib/tenancy/request-tenant'
import { recordOnHost, recordTenant } from '@/lib/tenancy/host-record'
import { noteAuditSubject } from '@/lib/audit/route-subject'
import { invitationByToken, invitationForMember, isWrongMember, loadSession, type OpenedFrom, type SurveySession } from './access'

export type Ref = { token: string } | { invitationId: string }

export type Resolved = { db: SupabaseClient; session: SurveySession; from: OpenedFrom } | { error: Response }

const json = (status: number, error: string) => ({ error: NextResponse.json({ error }, { status }) })

async function limitSurveyRequest(req: Request, write: boolean): Promise<Response | null> {
  return await rateLimit(req, 'survey', { limit: write ? 120 : 60, windowMs: 60_000, tenantId: (await requestTenant()).tenantId })
}

export async function resolveSession(req: Request, ref: Ref, opts: { write: boolean }): Promise<Resolved> {
  const limited = await limitSurveyRequest(req, opts.write)
  if (limited) return { error: limited }
  const db = supabaseServer()

  if ('token' in ref) {
    const inv = await invitationByToken(db, ref.token)
    if (!inv) return json(404, 'This survey link isn’t valid.')
    if (!(await recordOnHost(inv))) return json(404, 'This survey link isn’t valid.')
    noteAuditSubject(req, { tenantId: recordTenant(inv.tenant_id), id: inv.id })
    const signedIn = await getSignedInMember().catch(() => null)
    if (await isWrongMember(db, inv, signedIn?.id ?? null)) {
      return json(403, 'This survey link belongs to someone else. Sign out, or use your own link.')
    }
    const session = await loadSession(db, inv)
    if (!session) return json(404, 'This survey isn’t available.')
    const from = new URL(req.url).searchParams.get('from') === 'qr' ? 'qr' : 'email'
    return { db, session, from }
  }

  if (opts.write) {
    const blocked = await assertNotImpersonating()
    if (blocked) return { error: blocked }
  }
  const member = await getCurrentMember()
  if (!member) return json(401, 'Sign in to see your surveys.')
  const inv = await invitationForMember(db, member.id, ref.invitationId)
  if (!inv) return json(404, 'Survey not found.')
  const session = await loadSession(db, inv)
  if (!session) return json(404, 'This survey isn’t available.')
  return { db, session, from: new URL(req.url).searchParams.get('from') === 'qr' ? 'qr' : 'dashboard' }
}
