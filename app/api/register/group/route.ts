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

/** What the audit event says, filled in as the request goes. */
interface AuditNote {
  status: number
  userId: string | null
  registrationId: string | null
  eventTenantId: string | null
}

/**
 * S5 A7: one platform audit event per registration, after the response, off unless
 * PLATFORM_AUDIT_ENABLED=true. A 4xx is a refusal that wrote nothing of its own and is
 * not recorded, the rule withAudit applies (lib/audit/route). A 5xx may have written
 * part of a registration, so it is.
 */
async function recordRegistration(note: AuditNote): Promise<void> {
  if (note.status >= 400 && note.status < 500) return
  await auditMutation(
    {
      action: 'registration.group.create',
      actor: { userId: note.userId },
      // Stellr's chain, a tenant's event included, until the owner decides which
      // chain a tenant event's registration rows go on (docs/TENANCY-S5.md, B16).
      tenant: { stellr: true },
      target: note.registrationId ? { table: 'registrations', id: note.registrationId } : undefined,
      metadata: {
        status: note.status,
        ...(note.eventTenantId && note.eventTenantId !== STELLR_TENANT_ID ? { event_tenant_id: note.eventTenantId } : {}),
      },
    },
    { afterResponse: true },
  )
}

export async function POST(req: NextRequest) {
  const requestStartedAt = Date.now()
  const note: AuditNote = { status: 500, userId: null, registrationId: null, eventTenantId: null }
  const answer = (res: Response): Response => {
    note.status = res.status
    return res
  }
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
      registrant_on_invoice,
      late_joiner_payer,
      share_estimate,
      discount_code,
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
      registrant_on_invoice: registrant_on_invoice === true,
      late_joiner_payer: late_joiner_payer === 'group' ? 'group' : 'self',
      // "Invoice for some" is never everyone paying individually; sharing the
      // teacher's cost always is (the teachers are covered, the students pay).
      ...(payment_method === 'invoice_some' ? { member_pays_individually: false } : {}),
      ...(payment_method === 'teacher_share'
        ? { member_pays_individually: true, share_estimate: Number.isInteger(share_estimate) ? share_estimate : undefined }
        : {}),
      // A code for the invoice; the other ways to pay have their own code box.
      ...((payment_method === 'invoice' || payment_method === 'invoice_some') && typeof discount_code === 'string' && discount_code.trim()
        ? { discount_code: discount_code.trim().slice(0, 64) }
        : {}),
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
    note.userId = userId
    const { tenantId } = await requestTenant()
    // Only on Stellr's host. A tenant's event never asks an organiser on file to sign
    // in, and its gate takes no sign-in as an identity (S5 A7 follow-up), so a
    // signed-in caller there counts against the same allowance as anyone else.
    const sessionUserId = tenantId === STELLR_TENANT_ID ? userId : null
    if (sessionUserId) {
      const eventCapped = await rateLimit(req, 'register-group-session', { limit: 30, windowMs: HOUR_MS, tenantId }, eventKey)
      if (eventCapped) {
        note.status = eventCapped.status
        return eventCapped
      }
    }
    const rateLimited = await rateLimit(
      req,
      'register-group',
      { limit: 3, windowMs: HOUR_MS, tenantId },
      sessionUserId ? `${eventKey}:${sessionUserId}` : eventKey,
    )
    if (rateLimited) {
      note.status = rateLimited.status
      return rateLimited
    }

    // Read-only while an admin is viewing as this member. Impersonation is a lens,
    // not a login — an admin must never post, book or pay as somebody else.
    const impersonationBlock = await assertNotImpersonating()
    if (impersonationBlock) return answer(impersonationBlock)

    const gate = await gateGroupRegistration(fields, {
      serviceClient: supabaseServer,
      getEvent: getEventBySlug,
      requestTenantId: tenantId,
    })
    if (!gate.ok) return answer(gate.response)
    const { group } = gate
    note.eventTenantId = group.context.tenantId

    // The order of these writes is part of the route's behaviour: see the note on
    // partial state in lib/registration/group/persist.
    const saved = await insertGroupRegistration(group, fields)
    if (!saved.ok) return answer(saved.response)
    const { regId } = saved.registration
    note.registrationId = regId

    const savedMembers = await saveGroupMembers(group, fields, regId)
    if (!savedMembers.ok) return answer(savedMembers.response)
    const { members } = savedMembers

    await runGroupMemberHooks(group, fields, regId, members)
    await linkRegistrantMember(group, regId, members)
    const signInToken = await provisionRegistrantLogin(group, members)

    const savedParticipants = await insertGroupParticipants(group, fields, regId, members)
    if (!savedParticipants.ok) return answer(savedParticipants.response)
    const { participants } = savedParticipants

    scheduleGroupFollowUp(group, fields, regId, participants, requestStartedAt)

    return answer(await respondToGroupRegistration(group, fields, saved.registration, members, participants, signInToken, getEventBySlug))
  } catch (e) {
    console.error('Group registration error:', e)
    note.status = 500
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  } finally {
    await recordRegistration(note)
  }
}
