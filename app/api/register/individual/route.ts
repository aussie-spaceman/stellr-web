import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import type { RegistrationRow, ParticipantRow } from '@/lib/database.types'
import { dispatchAgreement } from '@/lib/docusign-agreements'
import { normalizeGender, normalizeAgeBracket, normalizeEventRole, normalizeGrade, normalizeTshirt } from '@/lib/member-enums'
import { resolveAndLinkSchool } from '@/lib/school-link'
import { recordEventParticipation } from '@/lib/event-participation-sync'
import { syncMemberOptionSelections } from '@/lib/member-profile-options'
import { getCurrentMember } from '@/lib/community'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

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
    const email: string = sessionMember?.email ?? body.email

    if (!event_slug || !email || !first_name || !last_name) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
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

    // Create registration record
    const { data: registration, error: regError } = await db
      .from('registrations')
      .insert({
        event_slug,
        event_title,
        type: 'individual',
        status: 'pending',
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
    const resolvedRole = ageNow < 18 ? 'school_student' : normalizeEventRole(event_role)

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
    await recordEventParticipation(db, { memberId, eventSlug: event_slug, eventTitle: event_title })

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

    // Look up Stripe Price ID from Sanity
    const event = await getEventBySlug(event_slug)
    const stripePriceId = (event as { stripePriceId?: string } | null)?.stripePriceId
    const stripe = getStripe()

    if (!stripePriceId || !stripe) {
      // No payment configured — go straight to confirmation
      return NextResponse.json({ registrationId: regId, checkoutUrl: null }, { status: 201 })
    }

    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: stripePriceId, quantity: 1 }],
      client_reference_id: regId,
      customer_email: email,
      metadata: {
        registrationId: regId,
        eventSlug: event_slug,
        participantName: `${first_name} ${last_name}`,
      },
      success_url: `${SITE_URL}/register/${event_slug}/confirmation?id=${regId}&type=individual&payment=success`,
      cancel_url: `${SITE_URL}/register/${event_slug}/individual?cancelled=true`,
    })

    return NextResponse.json({ registrationId: regId, checkoutUrl: session.url }, { status: 201 })
  } catch (e) {
    console.error('Individual registration error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
