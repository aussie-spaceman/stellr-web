import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { isAdminClaims } from '@/lib/admin-auth'
import { supabaseServer } from '@/lib/supabase'
import { logActivity, actorFromAuth } from '@/lib/activity-log'
import {
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
    .select('id, first_name, last_name, email')
    .eq('id', memberId)
    .maybeSingle()
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

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
  void logActivity({
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
