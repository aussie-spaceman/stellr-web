import { auth } from '@clerk/nextjs/server'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { isStellrAdmin, isViewAsTargetCrew } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { logActivityOrThrow, actorFromAuth, type Actor } from '@/lib/activity-log'
import {
  decodeTicket,
  encodeTicket,
  impersonationConfigured,
  ImpersonationNotConfiguredError,
  IMPERSONATION_COOKIE,
  IMPERSONATION_TTL_SECONDS,
  type ImpersonationTicket,
} from '@/lib/impersonation'
import { audit, auditEnabled } from '@/lib/audit/platform'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// Start / stop "view as member" for the whole member portal.
//
// POST { memberId } sets a short-lived signed cookie; DELETE clears it. The
// admin's own Clerk session is untouched throughout — the cookie only tells
// member-facing code which member to resolve, and lib/impersonation re-checks
// the admin claim, and that the caller is the admin who started it, on every
// request that reads it.
//
// S0 (Nov 2026): every check here fails closed. The start and the end are
// audited with logActivityOrThrow, and neither takes effect unless its row is
// written: a session nobody can see in the member's timeline must not exist.

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function cookieOptions(maxAge: number) {
  return { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge }
}

function refuse(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

/** True only when the member is definitely gone: the lookup worked and found no row. */
async function memberIsGone(memberId: string): Promise<boolean> {
  const { data, error } = await supabaseServer().from('members').select('id').eq('id', memberId).maybeSingle()
  return !error && !data
}

/**
 * Record the end of a session. Throws when it cannot be recorded, so the
 * caller leaves the session running — except when the viewed member has since
 * been purged. member_activity_log rows cascade with the member (migration
 * 046), so that insert can never succeed, the start row is already gone, and
 * refusing would trap the admin in a session with no exit for 30 minutes.
 *
 * The row names the admin who started the session (metadata.adminMemberId,
 * from the signed ticket) as well as whoever ended it.
 */
async function logEnded(ticket: ImpersonationTicket, reason: 'exited' | 'replaced', actor: Actor) {
  try {
    await logActivityOrThrow({
      ...actor,
      memberId: ticket.memberId,
      category: 'account',
      action: 'impersonation_ended',
      summary: 'An admin stopped viewing the portal as this member',
      metadata: { reason, adminMemberId: ticket.adminMemberId },
    })
  } catch (err) {
    if (await memberIsGone(ticket.memberId)) {
      console.warn('[impersonation] viewed member no longer exists; ending view-as with nothing to record')
      return
    }
    throw err
  }
}

/**
 * S4 platform audit, shadow-only: a second record of each view-as edge in
 * platform_audit_events (lib/audit/platform.ts), on Stellr's chain. Off unless
 * PLATFORM_AUDIT_ENABLED=true. It runs only after the member_activity_log row
 * above is written, never throws and is time-bounded, so it cannot change
 * whether a session starts or ends. metadata is ids only.
 */
async function auditViewAs(
  action: 'support.impersonate.start' | 'support.impersonate.stop',
  actorClerkId: string | null,
  ticket: { memberId: string; adminMemberId: string },
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (!auditEnabled()) return
  await audit({
    tenantId: STELLR_TENANT_ID,
    actor: actorClerkId ?? 'system',
    action,
    target: { table: 'members', id: ticket.memberId },
    metadata: { adminMemberId: ticket.adminMemberId, ...extra },
  })
}

/** The caller's Clerk id, or null when there is none (or it cannot be read). */
async function callerClerkId(): Promise<string | null> {
  try {
    return (await auth()).userId ?? null
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId || !(await isStellrAdmin({ route: '/api/admin/impersonation' }))) return refuse(403, 'Forbidden')

  // No dedicated signing secret means no unforgeable ticket. Say so plainly
  // rather than falling back to some other key.
  if (!impersonationConfigured()) return refuse(503, new ImpersonationNotConfiguredError().message)

  const body = await req.json().catch(() => ({}))
  const memberId = typeof body.memberId === 'string' ? body.memberId : null
  if (!memberId) return refuse(400, 'memberId required')
  // A malformed id would fail Postgres's uuid cast and read as a database error.
  if (!UUID.test(memberId)) return refuse(400, 'memberId must be a member id')

  const db = supabaseServer()
  const { data: member, error: memberError } = await db
    .from('members')
    .select('id, first_name, last_name, email, clerk_user_id')
    .eq('id', memberId)
    .maybeSingle()
  if (memberError) return refuse(500, 'Could not load the member.')
  if (!member) return refuse(404, 'Member not found')

  // deep review AUTH-9 + S0: view-as is an oversight lens over MEMBER portals.
  // One staff member must not use it to step into another's account — an admin
  // or an event manager, whose portal shows events and people they manage.
  // Staff status lives in two places, and both are checked:
  //   - an admin_duties row (platform function scopes, migration 044);
  //   - the Clerk publicMetadata.role of the target's Clerk user.
  // Either lookup failing refuses the request. This used to allow on a Clerk
  // error, which made the refusal of an admin target only as strong as Clerk's
  // uptime, and it only refused role 'admin'. The one Clerk error that is an
  // answer is 404: a Clerk user that does not exist cannot sign in or hold a
  // role (a missed user.deleted webhook leaves such ids behind), and admin_duties
  // has already been checked, so that target is not staff.
  const targetClerkId = (member as { clerk_user_id: string | null }).clerk_user_id
  try {
    if (await isViewAsTargetCrew({ memberId, clerkUserId: targetClerkId }, { route: '/api/admin/impersonation' })) {
      return refuse(403, 'Cannot view as a crew member.')
    }
  } catch (err) {
    console.error('[impersonation] could not verify the target is not crew:', err)
    return refuse(503, 'Could not confirm this member is not crew, so view-as was not started. Try again.')
  }

  // The ticket is bound to the admin who starts it (lib/impersonation
  // getImpersonation), so an admin with no member row cannot hold one. This
  // used to issue an unbound ticket that any admin could replay.
  const { data: adminRow, error: adminError } = await db
    .from('members')
    .select('id')
    .eq('clerk_user_id', userId)
    .maybeSingle()
  if (adminError) return refuse(500, 'Could not load your member record.')
  const adminMemberId = (adminRow as { id: string } | null)?.id
  if (!adminMemberId) {
    return refuse(403, 'Your admin account has no member record, so a view-as session cannot be tied to you.')
  }

  const ticket = encodeTicket({ memberId, adminMemberId, issuedAt: Date.now() })

  // Switching straight from one member to another closes the first session in
  // the audit trail too, so every start has an end.
  const jar = await cookies()
  const previous = decodeTicket(jar.get(IMPERSONATION_COOKIE)?.value)

  // deep review QUAL-1: this audit row is a safeguarding control — an adult
  // staff member viewing a minor's portal. It is awaited, and S0 made it
  // mandatory: if it cannot be written, the new session is not started.
  //
  // Who started it is the admin verified above, not whatever actorFromAuth's
  // best-effort lookup returns: that falls back to an anonymous 'system' actor
  // on any error, and "who viewed this child" must not depend on it. The label
  // is still taken from it, best-effort.
  const actor: Actor = { ...(await actorFromAuth()), actorType: 'admin', actorMemberId: adminMemberId }
  if (previous) {
    try {
      await logEnded(previous, 'replaced', actor)
    } catch (err) {
      console.error('[impersonation] audit write failed; leaving the previous view-as running:', err)
      return refuse(
        503,
        'Could not record the end of your current view-as session, so a new one was not started. Try again.',
      )
    }
  }
  try {
    await logActivityOrThrow({
      ...actor,
      memberId,
      category: 'account',
      action: 'impersonation_started',
      summary: 'An admin began viewing the portal as this member (read only)',
      metadata: { adminMemberId },
    })
  } catch (err) {
    console.error('[impersonation] audit write failed; not starting view-as:', err)
    if (!previous) {
      return refuse(503, 'Could not record the start of this view-as session, so it was not started. Try again.')
    }
    // The previous session's end is already on the record. Leaving its cookie
    // in place would keep that session running while the audit trail says it
    // ended, so end it for real as well: the record and the live session agree.
    const res = refuse(
      503,
      'Could not record the start of this view-as session, so it was not started. Your previous view-as session has ended. Try again.',
    )
    res.cookies.set(IMPERSONATION_COOKIE, '', cookieOptions(0))
    return res
  }

  if (previous) await auditViewAs('support.impersonate.stop', userId, previous, { reason: 'replaced' })
  await auditViewAs('support.impersonate.start', userId, { memberId, adminMemberId })

  const m = member as { first_name: string | null; last_name: string | null; email: string | null }
  const res = NextResponse.json({
    ok: true,
    memberName: [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email || 'Member',
  })
  res.cookies.set(IMPERSONATION_COOKIE, ticket, cookieOptions(IMPERSONATION_TTL_SECONDS))
  return res
}

export async function DELETE() {
  // Deliberately NOT admin-gated: clearing the cookie can only ever reduce
  // access.
  //
  // deep review AUTH-9: log the END of a view-as session as well as the start,
  // so an access review sees both edges of the window rather than an open-ended
  // one. An expired, forged or unreadable ticket is no session, so there is
  // nothing to record and the cookie is simply cleared.
  //
  // S0: when there IS a live session, its end is recorded before the cookie is
  // cleared, and a failed write leaves the session running (still read only,
  // still capped by the 30-minute TTL) with an error the banner shows, rather
  // than a gap in the audit trail. The one exception is a viewed member who has
  // since been purged (logEnded).
  //
  // The caller here is not verified (see above), so the row records them as
  // actorFromAuth finds them, and names the admin who started the session from
  // the signed ticket.
  const jar = await cookies()
  const ticket = decodeTicket(jar.get(IMPERSONATION_COOKIE)?.value)
  if (ticket) {
    try {
      await logEnded(ticket, 'exited', await actorFromAuth())
    } catch (err) {
      console.error('[impersonation] audit write failed; leaving view-as running:', err)
      return refuse(503, 'Could not record the end of this view-as session, so it is still running. Try again.')
    }
    if (auditEnabled()) await auditViewAs('support.impersonate.stop', await callerClerkId(), ticket, { reason: 'exited' })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(IMPERSONATION_COOKIE, '', cookieOptions(0))
  return res
}
