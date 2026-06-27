import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import { registrationStatus } from '@/lib/utils'
import type { RegistrationRow, ParticipantRow } from '@/lib/database.types'
import { dispatchAgreement } from '@/lib/docusign-agreements'
import { normalizeGender, normalizeAgeBracket, normalizeEventRole, normalizeGrade, normalizeTshirt, normalizeEmail } from '@/lib/member-enums'
import { resolveAndLinkSchool } from '@/lib/school-link'
import { recordEventParticipation } from '@/lib/event-participation-sync'
import { syncMemberOptionSelections } from '@/lib/member-profile-options'
import { getCurrentMember } from '@/lib/community'
import { ensureClerkUserAndSignInToken } from '@/lib/clerk-provisioning'
import { prepareRegistrationAddons, addRegistrationAddons } from '@/lib/store/event-merch'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
const APP_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'
// Where a registrant lands afterwards — the member portal, with a flag the
// /community page reads to pop the "registration submitted" modal.
const POST_REGISTER_URL = `${APP_URL}/community?registered=1&type=individual`

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      event_slug, event_title,
      first_name, last_name, nickname, phone, date_of_birth,
      grade, gender, ethnicity, t_shirt_size, school_name,
      age_bracket, event_role,
      dietary_requirements, health_conditions,
      emergency_contact_first_name, emergency_contact_last_name,
      emergency_contact_email, emergency_contact_phone,
      emergency_contact_relationship,
      school_address_state,
    } = body

    // Option A — a signed-in member can only register under their own address.
    // Trust the session email over whatever the client submitted; this prevents
    // duplicate member rows and forged-identity registrations. Falls back to the
    // submitted email when there's no resolvable session (e.g. on www).
    const sessionMember = await getCurrentMember().catch(() => null)
    const email: string = normalizeEmail(sessionMember?.email ?? body.email)

    if (!event_slug || !email || !first_name || !last_name) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Registration window gate — reject before creating any records / sending
    // DocuSign if the event's registration isn't currently open (FR-EVT).
    const eventForGate = await getEventBySlug(event_slug).catch(() => null)
    if (eventForGate) {
      const regStatus = registrationStatus(
        eventForGate.registrationOpen ?? false,
        eventForGate.registrationOpenDate,
        eventForGate.registrationCloseDate,
      )
      if (regStatus !== 'open') {
        return NextResponse.json({ error: 'Registration is not open for this event.' }, { status: 403 })
      }
    }

    // School is mandatory — accept either an existing school id or a non-empty
    // new-school name. Server-side backstop so the requirement holds even if the
    // client validation is bypassed.
    const hasSchool = !!body.school_id || (typeof school_name === 'string' && school_name.trim().length > 0)
    if (!hasSchool) {
      return NextResponse.json({ error: 'Please select your school.' }, { status: 400 })
    }

    const db = supabaseServer()

    // Duplicate check: same email for the same event
    const { data: existing } = await db
      .from('participants')
      .select('id, registration_id')
      .eq('email', email)
      .maybeSingle()

    if (existing) {
      const { data: reg } = await db
        .from('registrations')
        .select('event_slug')
        .eq('id', (existing as Pick<ParticipantRow, 'id' | 'registration_id'>).registration_id)
        .maybeSingle()

      if (reg && (reg as Pick<RegistrationRow, 'event_slug'>).event_slug === event_slug) {
        return NextResponse.json(
          { error: 'This email address is already registered for this event.' },
          { status: 409 }
        )
      }
    }

    // Amount owed: the per-seat event fee (one seat), or 0 when the event has no
    // Stripe price (free event). Drives the payment access gate.
    let amountDueCents = 0
    const feePriceId = (eventForGate as { stripePriceId?: string } | null)?.stripePriceId
    const feeStripe = getStripe()
    if (feePriceId && feeStripe) {
      try {
        const pr = await feeStripe.prices.retrieve(feePriceId)
        amountDueCents = pr.unit_amount ?? 0
      } catch (e) {
        console.error('[register/individual] price lookup failed (amount_due defaults 0):', e)
      }
    }

    // Create registration record
    const { data: registration, error: regError } = await db
      .from('registrations')
      .insert({
        event_slug,
        event_title,
        type: 'individual',
        status: 'pending',
        amount_due_cents: amountDueCents,
        invoice_requested: false,
        teacher_first_name: null,
        teacher_last_name: null,
        teacher_email: null,
        school_name: null,
        school_address_street: null,
        school_address_city: null,
        school_address_state: null,
        school_address_zip: null,
        withdrawn_at: null,
      })
      .select('id')
      .single()

    if (regError || !registration) {
      console.error('Registration insert error:', regError)
      return NextResponse.json({ error: 'Failed to create registration' }, { status: 500 })
    }

    const regId = (registration as Pick<RegistrationRow, 'id'>).id

    // Upsert member record — creates one if this email hasn't registered before
    const dob = new Date(date_of_birth)
    const ageNow = new Date().getFullYear() - dob.getFullYear()
    const resolvedBracket = ageNow < 18 ? 'high_school' : normalizeAgeBracket(age_bracket)
    const resolvedRole = ageNow < 18 ? 'participant' : normalizeEventRole(event_role)

    const { data: memberRow, error: memberUpsertError } = await db
      .from('members')
      .upsert({
        email,
        first_name,
        last_name,
        nickname: nickname || null,
        phone,
        date_of_birth,
        gender: normalizeGender(gender),
        grade: normalizeGrade(grade),
        tshirt_size: normalizeTshirt(t_shirt_size),
        age_bracket: resolvedBracket,
        event_role: resolvedRole,
        is_active: true,
        // Persist the profile so the member doesn't re-enter it next time (028).
        // Emergency contact goes to the members table's canonical ec_* columns —
        // the same ones /account, admin, and group-join read (029). Ethnicity and
        // dietary go to the member_ethnicities/member_allergies join tables below
        // for the same reason (030).
        health_conditions: health_conditions || null,
        ec_first_name: emergency_contact_first_name || null,
        ec_last_name: emergency_contact_last_name || null,
        ec_email: emergency_contact_email || null,
        ec_phone: emergency_contact_phone || null,
        ec_relationship: emergency_contact_relationship || null,
      }, { onConflict: 'email', ignoreDuplicates: false })
      .select('id')
      .maybeSingle()
    if (memberUpsertError) {
      console.error('Member upsert error (non-fatal — participant still created):', memberUpsertError)
    }

    const memberId = memberRow?.id ?? null

    // Resolve the school to a schools row and link the member to it, so the
    // school surfaces in /admin/schools and on the member page — not just as
    // free text on the participant row. When the registrant picked an existing
    // school, school_id is authoritative (we link to it, never create a dupe);
    // otherwise we resolve-or-create by normalized name. resolvedSchool.state is
    // the canonical state used to fill the DocuSign "State of Residence" tab.
    const resolvedSchool = await resolveAndLinkSchool(db, memberId ? [memberId] : [], {
      id: body.school_id ?? null,
      name: school_name,
      address_street: body.school_address_street ?? null,
      address_city: body.school_address_city ?? null,
      address_state: school_address_state ?? null,
      address_zip: body.school_address_zip ?? null,
    })
    if (memberId) {
      await syncMemberOptionSelections(db, [
        { memberId, ethnicity, dietary: dietary_requirements },
      ])
    }

    // Create participant record
    const { data: partRow, error: partError } = await db.from('participants').insert({
      registration_id: regId,
      member_id: memberId,
      first_name, last_name, nickname: nickname || null,
      email, phone, date_of_birth, grade, gender,
      ethnicity: ethnicity ?? [],
      t_shirt_size, school_name, age_bracket,
      event_role: resolvedRole,
      dietary_requirements: dietary_requirements ?? [],
      health_conditions: health_conditions || null,
      emergency_contact_first_name, emergency_contact_last_name,
      emergency_contact_email, emergency_contact_phone,
      emergency_contact_relationship: emergency_contact_relationship || null,
    }).select('id').single()

    if (partError || !partRow) {
      console.error('Participant insert error:', partError)
      await db.from('registrations').delete().eq('id', regId)
      return NextResponse.json({ error: 'Failed to save participant details' }, { status: 500 })
    }

    // Record this registration in event_participations so it appears in the
    // "Event Activity" lists on the member portal and admin member page.
    await recordEventParticipation(db, { memberId, eventSlug: event_slug, eventTitle: event_title, registrationId: regId })

    // Trigger the appropriate DocuSign agreement (minor consent, or self-signed
    // adult/mentor participation agreement) for this participant.
    await dispatchAgreement(db, {
      participantId:     partRow.id,
      memberId,
      eventSlug:         event_slug,
      eventTitle:        event_title,
      firstName:         first_name,
      lastName:          last_name,
      email,
      phone,
      dateOfBirth:       date_of_birth,
      eventRole:         event_role,
      schoolName:        school_name,
      // Prefer the canonical state on the linked school row — the form only
      // sends an address (and thus a state) for brand-new schools, so for an
      // existing-school selection school_address_state is empty.
      schoolState:       resolvedSchool?.state ?? school_address_state ?? null,
      guardianFirstName: emergency_contact_first_name,
      guardianLastName:  emergency_contact_last_name,
      guardianEmail:     emergency_contact_email,
      guardianPhone:     emergency_contact_phone,
      relationship:      emergency_contact_relationship,
    })

    // Provision a Clerk account + sign-in token so a brand-new registrant is
    // silently signed in and lands in the member portal (/community) afterwards.
    // Already-signed-in members have a session + clerk_user_id already. Non-fatal
    // — a Clerk hiccup must never fail the registration.
    let signInToken: string | null = null
    if (!sessionMember) {
      try {
        const provisioned = await ensureClerkUserAndSignInToken(email, first_name, last_name)
        signInToken = provisioned.signInToken
        if (memberId) {
          await db.from('members').update({ clerk_user_id: provisioned.clerkUserId }).eq('id', memberId)
        }
      } catch (clerkErr) {
        console.error('Clerk provisioning (non-fatal):', clerkErr)
      }
    }

    // Look up Stripe Price ID from Sanity + price any merch add-ons selected.
    const event = await getEventBySlug(event_slug)
    const stripePriceId = (event as { stripePriceId?: string } | null)?.stripePriceId
    const stripe = getStripe()

    // Validate + persist paid add-ons (pending until payment clears; activated
    // into the event batch on confirmation).
    const addonLines = await prepareRegistrationAddons(db, event_slug, body.merch_addons ?? [])
    if (addonLines.length > 0) {
      await addRegistrationAddons(db, regId, addonLines, memberId)
    }

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = []
    if (stripePriceId) lineItems.push({ price: stripePriceId, quantity: 1 })
    for (const l of addonLines) {
      lineItems.push({
        quantity: l.qty,
        price_data: { currency: 'usd', unit_amount: l.unitCents, product_data: { name: l.name } },
      })
    }

    if (!stripe || lineItems.length === 0) {
      // No payment due — sign in (client) and go straight to /community.
      return NextResponse.json({ registrationId: regId, checkoutUrl: null, signInToken }, { status: 201 })
    }

    // Create Stripe Checkout session (event fee + any add-ons)
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      client_reference_id: regId,
      customer_email: email,
      // Always mint a Customer so the receipt is retrievable in the billing tab
      // (the webhook persists session.customer onto the member row).
      customer_creation: 'always',
      metadata: {
        registrationId: regId,
        eventSlug: event_slug,
        participantName: `${first_name} ${last_name}`,
      },
      // After payment, land in the member portal with the registration modal —
      // the client signs the registrant in before redirecting to Stripe, so the
      // session cookie is already set when they return here.
      success_url: `${POST_REGISTER_URL}&payment=success`,
      cancel_url: `${SITE_URL}/register/${event_slug}/individual?cancelled=true`,
    })

    return NextResponse.json({ registrationId: regId, checkoutUrl: session.url, signInToken }, { status: 201 })
  } catch (e) {
    console.error('Individual registration error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
