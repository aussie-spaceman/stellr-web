import { auth, clerkClient } from '@clerk/nextjs/server'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { isAdminClaims } from '@/lib/admin-auth'
import { supabaseServer } from '@/lib/supabase'
import { logActivity, actorFromAuth } from '@/lib/activity-log'
import {
  decodeTicket,
  encodeTicket,
  IMPERSONATION_COOKIE,
  IMPERSONATION_TTL_SECONDS,
} from '@/lib/impersonation'

// Start / stop "view as member" for the whole member portal.
//
// POST { memberId } sets a short-lived signed cookie; DELETE clears it. The
// admin's own Clerk session is untouched throughout — the cookie only tells
// member-facing code which member to resolve, and lib/impersonation re-checks
// the admin claim on every request that reads it.

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const { userId, sessionClaims } = await auth()
  if (!userId || !isAdminClaims(sessionClaims)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const memberId = typeof body.memberId === 'string' ? body.memberId : null
  if (!memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })

  const db = supabaseServer()
  const { data: member } = await db
    .from('members')
    .select('id, first_name, last_name, email, clerk_user_id')
    .eq('id', memberId)
    .maybeSingle()
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  // deep review AUTH-9: refuse to view-as another platform admin. View-as is an
  // oversight lens over MEMBER portals; one admin must not use it to step into
  // another admin's account. Admin status lives in Clerk publicMetadata.role, so
  // resolve it from the target's Clerk user. A confirmed admin is refused. On a
  // Clerk error we allow and log: an admin target is read-only anyway
  // (assertNotImpersonating blocks every write), and failing closed here would
  // take down the whole oversight tool during a Clerk outage.
  const targetClerkId = (member as { clerk_user_id: string | null }).clerk_user_id
  if (targetClerkId) {
    try {
      const client = await clerkClient()
      const u = await client.users.getUser(targetClerkId)
      if ((u.publicMetadata as { role?: string } | null)?.role === 'admin') {
        return NextResponse.json({ error: 'Cannot view as another admin.' }, { status: 403 })
      }
    } catch (err) {
      console.error('[impersonation] could not verify target admin status:', err)
    }
  }

  const { data: adminRow } = await db
    .from('members')
    .select('id')
    .eq('clerk_user_id', userId)
    .maybeSingle()

  const ticket = encodeTicket({
    memberId,
    adminMemberId: (adminRow as { id: string } | null)?.id ?? null,
    issuedAt: Date.now(),
  })
  // No signing secret configured means we cannot issue an unforgeable ticket.
  // Fail closed and say so, rather than falling back to an unsigned cookie.
  if (!ticket) {
    return NextResponse.json(
      { error: 'Impersonation is not configured (no signing secret available).' },
      { status: 500 },
    )
  }

  const m = member as { first_name: string | null; last_name: string | null; email: string | null }
  // deep review QUAL-1: this audit row is a safeguarding control — an adult
  // staff member viewing a minor's portal. It was `void`ed, so the insert could
  // still be in flight when the instance was frozen after the response, and a
  // silently missing row cannot be detected later. Await it: one insert on an
  // already-slow path (two member lookups precede it).
  await logActivity({
    ...(await actorFromAuth()),
    memberId,
    category: 'account',
    action: 'impersonation_started',
    summary: 'An admin began viewing the portal as this member (read only)',
  })

  const res = NextResponse.json({
    ok: true,
    memberName: [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email || 'Member',
  })
  res.cookies.set(IMPERSONATION_COOKIE, ticket, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: IMPERSONATION_TTL_SECONDS,
  })
  return res
}

export async function DELETE() {
  // Deliberately NOT admin-gated: clearing the cookie can only ever reduce
  // access, and refusing to exit would be the worse failure.
  //
  // deep review AUTH-9: log the END of a view-as session as well as the start,
  // so an access review sees both edges of the window rather than an open-ended
  // one. Decode the current cookie first (best-effort — an expired or forged
  // ticket simply yields no row and we just clear the cookie).
  const jar = await cookies()
  const ticket = decodeTicket(jar.get(IMPERSONATION_COOKIE)?.value)
  if (ticket) {
    await logActivity({
      ...(await actorFromAuth()),
      memberId: ticket.memberId,
      category: 'account',
      action: 'impersonation_ended',
      summary: 'An admin stopped viewing the portal as this member',
    })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(IMPERSONATION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
  return res
}
