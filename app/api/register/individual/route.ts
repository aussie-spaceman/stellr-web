import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import type { RegistrationRow, ParticipantRow } from '@/lib/database.types'

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
      first_name, last_name, nickname, email, phone, date_of_birth,
      grade, gender, ethnicity, t_shirt_size, school_name,
      age_bracket, event_role,
      dietary_requirements, health_conditions,
      emergency_contact_first_name, emergency_contact_last_name,
      emergency_contact_email, emergency_contact_phone,
    } = body

    if (!event_slug || !email || !first_name || !last_name) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
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

    // Create participant record
    const { error: partError } = await db.from('participants').insert({
      registration_id: regId,
      first_name, last_name, nickname: nickname || null,
      email, phone, date_of_birth, grade, gender,
      ethnicity: ethnicity ?? [],
      t_shirt_size, school_name, age_bracket, event_role,
      dietary_requirements: dietary_requirements ?? [],
      health_conditions: health_conditions || null,
      emergency_contact_first_name, emergency_contact_last_name,
      emergency_contact_email, emergency_contact_phone,
    })

    if (partError) {
      console.error('Participant insert error:', partError)
      await db.from('registrations').delete().eq('id', regId)
      return NextResponse.json({ error: 'Failed to save participant details' }, { status: 500 })
    }

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
