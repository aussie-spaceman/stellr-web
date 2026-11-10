import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/events/repo'
import { HOUR_MS } from '@/lib/rate-limit'
import { rateLimit } from '@/lib/rate-limit-async'
import { requestTenant } from '@/lib/tenancy/request-tenant'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { auditMutation } from '@/lib/audit/route'
import { gateIndividualRegistration } from '@/lib/registration/individual/gate'
import type { IndividualBody } from '@/lib/registration/individual/parse'
import { persistIndividualRegistration } from '@/lib/registration/individual/persist'
import { respondToIndividualRegistration } from '@/lib/registration/individual/respond'
import { runIndividualHooks } from '@/lib/registration/individual/stellr-hooks'

// deep review QUAL-7: this handler dispatches a consent agreement, provisions a
// Clerk user and creates a Stripe checkout inline. Pin the ceiling to the plan
// maximum so it cannot be cut off mid-flow by the lower platform default.
export const maxDuration = 60

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
      action: 'registration.individual.create',
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
  const note: AuditNote = { status: 500, userId: null, registrationId: null, eventTenantId: null }
  const answer = (res: Response): Response => {
    note.status = res.status
    return res
  }
  try {
    const body = await req.json()
    // Each field is named in this file, not in lib/registration/individual/parse:
    // lib/security/route-ast finds a route's id-bearing inputs by reading the route,
    // so moving these reads would drop it from the generated IDOR suite.
    const fields: IndividualBody = {
      event_slug: body.event_slug, event_title: body.event_title,
      email: body.email, school_email: body.school_email, scholarship_token: body.scholarship_token,
      first_name: body.first_name, last_name: body.last_name, nickname: body.nickname,
      phone: body.phone, date_of_birth: body.date_of_birth,
      grade: body.grade, gender: body.gender, ethnicity: body.ethnicity, t_shirt_size: body.t_shirt_size,
      school_id: body.school_id, school_name: body.school_name,
      school_address_street: body.school_address_street, school_address_city: body.school_address_city,
      school_address_state: body.school_address_state, school_address_zip: body.school_address_zip,
      age_bracket: body.age_bracket, event_role: body.event_role,
      dietary_requirements: body.dietary_requirements, health_conditions: body.health_conditions,
      emergency_contact_first_name: body.emergency_contact_first_name,
      emergency_contact_last_name: body.emergency_contact_last_name,
      emergency_contact_email: body.emergency_contact_email,
      emergency_contact_phone: body.emergency_contact_phone,
      emergency_contact_relationship: body.emergency_contact_relationship,
      merch_addons: body.merch_addons,
    }

    // deep review AUTH-N2: rate-limit this public, unauthenticated write before
    // any member/registration/Clerk/email side effect. Each call creates a
    // member (+ passwordless Clerk user) and force-sends a pay-link email on a
    // shared free Resend quota (100/day); without a cap a scripted client could
    // exhaust the day's email and pollute members/registrations/Clerk. Matches
    // the other public forms (teacher-grant, host-event, join-network). Sub-keyed
    // by event slug so one venue's families registering for one event aren't
    // lumped with that IP's traffic to other events; limit stays tight because
    // the quota is shared.
    // A signed-in retry has its own count: an email on file is asked to sign in
    // first, and that refusal must not use up the household's or school's shared
    // allowance. A wider cap per event stops new accounts multiplying that count.
    const eventKey = typeof fields.event_slug === 'string' ? fields.event_slug : undefined
    const { userId } = await Promise.resolve().then(() => auth()).catch(() => ({ userId: null }))
    note.userId = userId
    const { tenantId } = await requestTenant()
    // Only on Stellr's host. A tenant's event never asks an email on file to sign in,
    // and its gate takes no sign-in as an identity (S5 A7 follow-up), so a signed-in
    // caller there counts against the same allowance as anyone else.
    const sessionUserId = tenantId === STELLR_TENANT_ID ? userId : null
    if (sessionUserId) {
      const eventCapped = await rateLimit(req, 'register-individual-session', { limit: 30, windowMs: HOUR_MS, tenantId }, eventKey)
      if (eventCapped) {
        note.status = eventCapped.status
        return eventCapped
      }
    }
    const rateLimited = await rateLimit(
      req,
      'register-individual',
      { limit: 3, windowMs: HOUR_MS, tenantId },
      sessionUserId ? `${eventKey}:${sessionUserId}` : eventKey,
    )
    if (rateLimited) {
      note.status = rateLimited.status
      return rateLimited
    }

    const gate = await gateIndividualRegistration(fields, {
      serviceClient: supabaseServer,
      getEvent: getEventBySlug,
      requestTenantId: tenantId,
    })
    if (!gate.ok) return answer(gate.response)
    note.eventTenantId = gate.registration.context.tenantId

    const saved = await persistIndividualRegistration(gate.registration, fields)
    if (!saved.ok) return answer(saved.response)
    note.registrationId = saved.row.regId

    const signInToken = await runIndividualHooks(gate.registration, saved.row, fields)
    return answer(await respondToIndividualRegistration(gate.registration, saved.row, signInToken, fields, getEventBySlug))
  } catch (e) {
    console.error('Individual registration error:', e)
    note.status = 500
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  } finally {
    await recordRegistration(note)
  }
}
