import { auth, clerkClient } from '@clerk/nextjs/server'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { isAdminClaims, isStaffRole } from '@/lib/admin-auth'
import { supabaseServer } from '@/lib/supabase'
import { logActivityOrThrow, actorFromAuth } from '@/lib/activity-log'
import {
  decodeTicket,
  encodeTicket,
  impersonationConfigured,
  ImpersonationNotConfiguredError,
  IMPERSONATION_COOKIE,
  IMPERSONATION_TTL_SECONDS,
  type ImpersonationTicket,
} from '@/lib/impersonation'

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

function cookieOptions(maxAge: number) {
  return { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge }
}

function refuse(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

async function logEnded(ticket: ImpersonationTicket, reason: 'exited' | 'replaced') {
  await logActivityOrThrow({
    ...(await actorFromAuth()),
    memberId: ticket.memberId,
    category: 'account',
    action: 'impersonation_ended',
    summary: 'An admin stopped viewing the portal as this member',
    metadata: { reason },
  })
}

export async function POST(req: Request) {
  const { userId, sessionClaims } = await auth()
  if (!userId || !isAdminClaims(sessionClaims)) return refuse(403, 'Forbidden')

  // No dedicated signing secret means no unforgeable ticket. Say so plainly
  // rather than falling back to some other key.
  if (!impersonationConfigured()) return refuse(503, new ImpersonationNotConfiguredError().message)

  const body = await req.json().catch(() => ({}))
  const memberId = typeof body.memberId === 'string' ? body.memberId : null
  if (!memberId) return refuse(400, 'memberId required')

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
  //   - a staff_roles row (platform function scopes, migration 044);
  //   - the Clerk publicMetadata.role of the target's Clerk user.
  // Either lookup failing refuses the request. This used to allow on a Clerk
  // error, which made the refusal of an admin target only as strong as Clerk's
  // uptime, and it only refused role 'admin'.
  const { data: staffRow, error: staffError } = await db
    .from('staff_roles')
    .select('member_id')
    .eq('member_id', memberId)
    .maybeSingle()
  if (staffError) return refuse(503, 'Could not confirm this member is not staff, so view-as was not started. Try again.')
  if (staffRow) return refuse(403, 'Cannot view as a staff member.')

  const targetClerkId = (member as { clerk_user_id: string | null }).clerk_user_id
  if (targetClerkId) {
    let role: unknown
    try {
      const client = await clerkClient()
      const u = await client.users.getUser(targetClerkId)
      role = (u.publicMetadata as { role?: unknown } | null)?.role
    } catch (err) {
      console.error('[impersonation] could not verify the target is not staff:', err)
      return refuse(503, 'Could not confirm this member is not staff, so view-as was not started. Try again.')
    }
    if (isStaffRole(role)) return refuse(403, 'Cannot view as a staff member.')
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
  let previousEnded = false
  try {
    if (previous) {
      await logEnded(previous, 'replaced')
      previousEnded = true
    }
    await logActivityOrThrow({
      ...(await actorFromAuth()),
      memberId,
      category: 'account',
      action: 'impersonation_started',
      summary: 'An admin began viewing the portal as this member (read only)',
    })
  } catch (err) {
    console.error('[impersonation] audit write failed; not starting view-as:', err)
    if (!previousEnded) {
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
  // than a gap in the audit trail.
  const jar = await cookies()
  const ticket = decodeTicket(jar.get(IMPERSONATION_COOKIE)?.value)
  if (ticket) {
    try {
      await logEnded(ticket, 'exited')
    } catch (err) {
      console.error('[impersonation] audit write failed; leaving view-as running:', err)
      return refuse(503, 'Could not record the end of this view-as session, so it is still running. Try again.')
    }
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(IMPERSONATION_COOKIE, '', cookieOptions(0))
  return res
}
