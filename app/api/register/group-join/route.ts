import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import { assertNotImpersonating } from '@/lib/impersonation'
import { rateLimitGuard, HOUR_MS } from '@/lib/rate-limit'
import { gateGroupJoinLink } from '@/lib/registration/group-join/gate'
import { identifyNewParticipant, identifySignedInMember } from '@/lib/registration/group-join/identify'
import { persistGroupJoin } from '@/lib/registration/group-join/persist'
import { respondToGroupJoin } from '@/lib/registration/group-join/respond'
import { runGroupJoinHooks } from '@/lib/registration/group-join/stellr-hooks'

// POST /api/register/group-join — self-register via a join token.
//   • Signed-in members join with one click (their profile is authoritative).
//   • Brand-new participants submit { token, details } and are provisioned a
//     passwordless Clerk account + sign-in token, so they're auto-logged-in on
//     success — no detour through the (timeout-prone) hosted sign-in widget.
export async function POST(req: NextRequest) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — see lib/impersonation.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const { userId } = await auth()
  const body = await req.json().catch(() => ({}))
  // token is read in this file, not in lib/registration/group-join: lib/security/
  // route-ast finds a route's id-bearing inputs by reading the route, so moving this
  // read would drop it from the generated IDOR suite.
  const { token, details } = body as { token?: string; details?: Record<string, unknown> }
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })

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
  const rateLimited = rateLimitGuard(req, 'register-group-join', { limit: 3, windowMs: HOUR_MS }, token)
  if (rateLimited) return rateLimited

  const db = supabaseServer()

  const gate = await gateGroupJoinLink(db, token, getEventBySlug)
  if (!gate.ok) return gate.response
  const { link } = gate

  const identified = userId
    ? await identifySignedInMember(db, userId, link.eventDate)
    : await identifyNewParticipant(db, details, link.eventDate)
  if (!identified.ok) return identified.response
  const { joiner } = identified

  const saved = await persistGroupJoin(db, link, joiner)
  if (!saved.ok) return saved.response

  await runGroupJoinHooks(db, link, joiner, saved.participantId)
  return respondToGroupJoin(db, link, joiner, saved.participantId)
}
