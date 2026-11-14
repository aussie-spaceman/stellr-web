import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/events/repo'
import { assertNotImpersonating } from '@/lib/impersonation'
import { HOUR_MS } from '@/lib/rate-limit'
import { rateLimit } from '@/lib/rate-limit-async'
import { requestTenant } from '@/lib/tenancy/request-tenant'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { auditMutation } from '@/lib/audit/route'
import { gateGroupJoinLink } from '@/lib/registration/group-join/gate'
import { identifyNewParticipant, identifySignedInMember } from '@/lib/registration/group-join/identify'
import { persistGroupJoin } from '@/lib/registration/group-join/persist'
import { respondToGroupJoin } from '@/lib/registration/group-join/respond'
import { runGroupJoinHooks } from '@/lib/registration/group-join/stellr-hooks'
import { reportError, responseError } from '@/lib/app-errors'

// POST /api/register/group-join — self-register via a join token.
//   • Signed-in members join with one click (their profile is authoritative).
//   • Brand-new participants submit { token, details } and are provisioned a
//     passwordless Clerk account + sign-in token, so they're auto-logged-in on
//     success — no detour through the (timeout-prone) hosted sign-in widget.
/** What the audit event says, filled in as the request goes. */
interface AuditNote {
  status: number
  userId: string | null
  participantId: string | null
  eventTenantId: string | null
}

/**
 * S5 A7: one platform audit event per join, after the response, off unless
 * PLATFORM_AUDIT_ENABLED=true. A 4xx is a refusal that wrote nothing of its own and is
 * not recorded, the rule withAudit applies (lib/audit/route). A 5xx may have written
 * part of a join, so it is.
 */
async function recordJoin(note: AuditNote): Promise<void> {
  if (note.status >= 400 && note.status < 500) return
  await auditMutation(
    {
      action: 'registration.group_join.create',
      actor: { userId: note.userId },
      // Stellr's chain, a tenant's event included, until the owner decides which
      // chain a tenant event's registration rows go on (docs/TENANCY-S5.md, B16).
      tenant: { stellr: true },
      target: note.participantId ? { table: 'participants', id: note.participantId } : undefined,
      metadata: {
        status: note.status,
        ...(note.eventTenantId && note.eventTenantId !== STELLR_TENANT_ID ? { event_tenant_id: note.eventTenantId } : {}),
      },
    },
    { afterResponse: true },
  )
}

/** The app_errors label: a fixed pattern, never a concrete path. */
const ERROR_ROUTE = 'POST /api/register/group-join'

export async function POST(req: NextRequest) {
  const note: AuditNote = { status: 500, userId: null, participantId: null, eventTenantId: null }
  const answer = (res: Response): Response => {
    note.status = res.status
    return res
  }
  // A failed insert the persist step caught and answered with its own 500 never
  // reaches Next's onRequestError, so it is reported here (lib/app-errors). This
  // handler has no catch: anything it throws reaches Next, and onRequestError
  // records it (captureRequestError) under this same route.
  const reportFailure = async (res: Response): Promise<Response> => {
    if (res.status >= 500) await reportError(await responseError(res), { route: ERROR_ROUTE })
    return res
  }
  try {
    // Read-only while an admin is viewing as this member. Impersonation is a lens,
    // not a login — see lib/impersonation.
    const impersonationBlock = await assertNotImpersonating()
    if (impersonationBlock) return answer(impersonationBlock)

    const { userId } = await auth()
    note.userId = userId
    const body = await req.json().catch(() => ({}))
    // token is read in this file, not in lib/registration/group-join: lib/security/
    // route-ast finds a route's id-bearing inputs by reading the route, so moving this
    // read would drop it from the generated IDOR suite.
    const { token, details } = body as { token?: string; details?: Record<string, unknown> }
    if (!token) return answer(NextResponse.json({ error: 'Token required' }, { status: 400 }))

    // deep review AUTH-N2: rate-limit this public, unauthenticated write before any
    // member/registration/Clerk/email side effect (and before the token lookup
    // read). A join adds a real participant (+ member / passwordless Clerk user)
    // and sends transactional email on a shared free Resend quota (100/day);
    // without a cap a scripted client could exhaust the day's email and pollute
    // members/registrations/Clerk. Matches the other public forms. Sub-keyed by
    // the join token: one token is exactly one event+group (the event slug isn't
    // known until the token is resolved below), so this is the per-link analogue
    // of the event-slug sub-key used by the individual/group routes and also caps
    // the token-lookup read path. Limit stays tight because the quota is shared.
    // A signed-in confirm has its own count: a member on file is asked to sign in
    // first, and that refusal must not use up the classroom's shared allowance. A
    // wider cap per link stops new accounts multiplying that count.
    const { tenantId } = await requestTenant()
    if (userId) {
      const linkCapped = await rateLimit(req, 'register-group-join-session', { limit: 30, windowMs: HOUR_MS, tenantId }, token)
      if (linkCapped) {
        note.status = linkCapped.status
        return linkCapped
      }
    }
    const rateLimited = await rateLimit(
      req,
      'register-group-join',
      { limit: 3, windowMs: HOUR_MS, tenantId },
      userId ? `${token}:${userId}` : token,
    )
    if (rateLimited) {
      note.status = rateLimited.status
      return rateLimited
    }

    const db = supabaseServer()

    const gate = await gateGroupJoinLink(db, token, getEventBySlug, tenantId)
    if (!gate.ok) return answer(gate.response)
    const identified = userId
      ? await identifySignedInMember(db, userId, gate.link.owner, details)
      : await identifyNewParticipant(db, details, gate.link.owner)
    if (!identified.ok) return answer(identified.response)
    const { joiner } = identified

    // S5 A7: identify confirmed the event's owner before it read anything about the
    // person; this is that same answer, not a second read.
    const owned = await gate.link.owner.confirm()
    if (!owned.ok) return answer(owned.response)
    const link = { ...gate.link, context: owned.context }
    note.eventTenantId = link.context.tenantId

    const saved = await persistGroupJoin(db, link, joiner)
    if (!saved.ok) return answer(await reportFailure(saved.response))
    note.participantId = saved.participantId

    await runGroupJoinHooks(db, link, joiner, saved.participantId)
    return answer(await respondToGroupJoin(db, link, joiner, saved.participantId))
  } finally {
    await recordJoin(note)
  }
}
