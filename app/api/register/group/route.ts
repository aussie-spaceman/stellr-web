import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import { assertNotImpersonating } from '@/lib/impersonation'
import { HOUR_MS } from '@/lib/rate-limit'
import { rateLimit } from '@/lib/rate-limit-async'
import { requestTenant } from '@/lib/tenancy/request-tenant'
import { gateGroupRegistration } from '@/lib/registration/group/gate'
import type { GroupBody } from '@/lib/registration/group/parse'
import {
  insertGroupParticipants,
  insertGroupRegistration,
  linkRegistrantMember,
  saveGroupMembers,
} from '@/lib/registration/group/persist'
import { respondToGroupRegistration } from '@/lib/registration/group/respond'
import {
  provisionRegistrantLogin,
  runGroupMemberHooks,
  scheduleGroupFollowUp,
} from '@/lib/registration/group/stellr-hooks'

// deep review QUAL-7 / 28 Oct 2026: the sheet, invoice and confirmation email
// run in the request; agreements, logins and clearance notices run after the
// response, inside the same invocation (runAfterResponse). 60 s was LOWER than
// the Fluid default and killed an 18-student team mid-dispatch, so the ceiling
// is the plan maximum, and the follow-up stops starting new work at its budget
// (lib/registration/group/stellr-hooks) so it always finishes inside it. Anything
// left is picked up by the daily sweeps.
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const requestStartedAt = Date.now()
  try {
    const body = await req.json()
    // Each field is named in this file, not in lib/registration/group/parse:
    // lib/security/route-ast finds a route's id-bearing inputs by reading the route,
    // so moving these reads would drop it from the generated IDOR suite.
    const {
      event_slug,
      registrant_role = 'teacher',
      teacher,
      teacher_poc,
      adult_count, student_count, total_participants,
      details_method = 'add_now',
      payment_method,
      member_pays_individually = false,
      additional_adults,
      students,
      school_dpa_agreed,
    } = body
    // deep review REG-3 / REG-4: event_title and campaign status come from the
    // server event (resolved in the gate), never from the client body. Both are
    // derived from the CMS document. The client's title is only the fallback for a
    // document with none.
    const fields: GroupBody = {
      event_slug, event_title: body.event_title, registrant_role, teacher, teacher_poc,
      adult_count, student_count, total_participants,
      details_method, payment_method, member_pays_individually,
      additional_adults, students, school_dpa_agreed,
    }

    // deep review AUTH-N2: rate-limit this public, unauthenticated write before
    // any member/registration/Clerk/email side effect. A group registration
    // creates many member + participant rows and sends transactional email on a
    // shared free Resend quota (100/day); without a cap a scripted client could
    // exhaust the day's email (including safeguarding/consent mail) and pollute
    // members/registrations/Clerk. Matches the other public forms
    // (teacher-grant, host-event, join-network). Sub-keyed by event slug so one
    // venue registering for one event isn't lumped with that IP's traffic to
    // other events; the limit stays tight because the quota is shared.
    // A signed-in retry has its own count: an organiser on file is asked to sign in
    // first, and the retry must not draw on the school's shared allowance. A wider
    // cap per event stops new accounts multiplying that count.
    const eventKey = typeof event_slug === 'string' ? event_slug : undefined
    const { userId } = await Promise.resolve().then(() => auth()).catch(() => ({ userId: null }))
    const { tenantId } = await requestTenant()
    if (userId) {
      const eventCapped = await rateLimit(req, 'register-group-session', { limit: 30, windowMs: HOUR_MS, tenantId }, eventKey)
      if (eventCapped) return eventCapped
    }
    const rateLimited = await rateLimit(
      req,
      'register-group',
      { limit: 3, windowMs: HOUR_MS, tenantId },
      userId ? `${eventKey}:${userId}` : eventKey,
    )
    if (rateLimited) return rateLimited

    // Read-only while an admin is viewing as this member. Impersonation is a lens,
    // not a login — an admin must never post, book or pay as somebody else.
    const impersonationBlock = await assertNotImpersonating()
    if (impersonationBlock) return impersonationBlock

    const gate = await gateGroupRegistration(fields, { serviceClient: supabaseServer, getEvent: getEventBySlug })
    if (!gate.ok) return gate.response
    const { group } = gate

    // The order of these writes is part of the route's behaviour: see the note on
    // partial state in lib/registration/group/persist.
    const saved = await insertGroupRegistration(group, fields)
    if (!saved.ok) return saved.response
    const { regId } = saved.registration

    const savedMembers = await saveGroupMembers(group, fields, regId)
    if (!savedMembers.ok) return savedMembers.response
    const { members } = savedMembers

    await runGroupMemberHooks(group, fields, regId, members)
    await linkRegistrantMember(group, regId, members)
    const signInToken = await provisionRegistrantLogin(group, members)

    const savedParticipants = await insertGroupParticipants(group, fields, regId, members)
    if (!savedParticipants.ok) return savedParticipants.response
    const { participants } = savedParticipants

    scheduleGroupFollowUp(group, fields, regId, participants, requestStartedAt)

    return await respondToGroupRegistration(group, fields, saved.registration, members, participants, signInToken, getEventBySlug)
  } catch (e) {
    console.error('Group registration error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
