import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import { HOUR_MS } from '@/lib/rate-limit'
import { rateLimit } from '@/lib/rate-limit-async'
import { requestTenant } from '@/lib/tenancy/request-tenant'
import { gateIndividualRegistration } from '@/lib/registration/individual/gate'
import type { IndividualBody } from '@/lib/registration/individual/parse'
import { persistIndividualRegistration } from '@/lib/registration/individual/persist'
import { respondToIndividualRegistration } from '@/lib/registration/individual/respond'
import { runIndividualHooks } from '@/lib/registration/individual/stellr-hooks'

// deep review QUAL-7: this handler dispatches a consent agreement, provisions a
// Clerk user and creates a Stripe checkout inline. Pin the ceiling to the plan
// maximum so it cannot be cut off mid-flow by the lower platform default.
export const maxDuration = 60

export async function POST(req: NextRequest) {
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
    const { tenantId } = await requestTenant()
    if (userId) {
      const eventCapped = await rateLimit(req, 'register-individual-session', { limit: 30, windowMs: HOUR_MS, tenantId }, eventKey)
      if (eventCapped) return eventCapped
    }
    const rateLimited = await rateLimit(
      req,
      'register-individual',
      { limit: 3, windowMs: HOUR_MS, tenantId },
      userId ? `${eventKey}:${userId}` : eventKey,
    )
    if (rateLimited) return rateLimited

    const gate = await gateIndividualRegistration(fields, { serviceClient: supabaseServer, getEvent: getEventBySlug })
    if (!gate.ok) return gate.response

    const saved = await persistIndividualRegistration(gate.registration, fields)
    if (!saved.ok) return saved.response

    const signInToken = await runIndividualHooks(gate.registration, saved.row, fields)
    return await respondToIndividualRegistration(gate.registration, saved.row, signInToken, fields, getEventBySlug)
  } catch (e) {
    console.error('Individual registration error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
