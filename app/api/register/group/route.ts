import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import { sendEmail, groupConfirmationEmail } from '@/lib/email'
import { createGroupRegistrationSheet, isGoogleSheetsConfigured } from '@/lib/google-sheets'
import type { RegistrationRow } from '@/lib/database.types'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

interface ParticipantPayload {
  first_name: string; last_name: string; email: string; phone: string
  date_of_birth: string; grade?: string; gender: string; t_shirt_size: string
  age_bracket: string; event_role: string
  dietary_requirements?: string[]; health_conditions?: string
  emergency_contact_first_name?: string; emergency_contact_last_name?: string
  emergency_contact_email?: string; emergency_contact_phone?: string
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      event_slug, event_title,
      teacher,
      adult_count, student_count, total_participants,
      details_method,
      payment_method,
      additional_adults,
      students,
    } = body

    if (!event_slug || !teacher?.email || !teacher?.first_name || !teacher?.last_name) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (student_count < 2) {
      return NextResponse.json({ error: 'A minimum of 2 students is required' }, { status: 400 })
    }

    const db = supabaseServer()

    // Duplicate check: teacher email
    const { data: existingTeacher } = await db
      .from('participants')
      .select('registration_id')
      .eq('email', teacher.email)
      .maybeSingle()

    if (existingTeacher) {
      const { data: reg } = await db.from('registrations').select('event_slug')
        .eq('id', (existingTeacher as { registration_id: string }).registration_id).maybeSingle()
      if (reg && (reg as Pick<RegistrationRow, 'event_slug'>).event_slug === event_slug) {
        return NextResponse.json({ error: 'This email address is already registered for this event.' }, { status: 409 })
      }
    }

    // Duplicate check: participant emails (add_now only)
    if (details_method === 'add_now') {
      const allEmails: string[] = [
        ...(additional_adults ?? []).map((a: ParticipantPayload) => a.email),
        ...(students ?? []).map((s: ParticipantPayload) => s.email),
      ]
      const duplicates: string[] = []
      for (const email of allEmails) {
        const { data: p } = await db.from('participants').select('registration_id').eq('email', email).maybeSingle()
        if (p) {
          const { data: reg } = await db.from('registrations').select('event_slug')
            .eq('id', (p as { registration_id: string }).registration_id).maybeSingle()
          if (reg && (reg as Pick<RegistrationRow, 'event_slug'>).event_slug === event_slug) {
            duplicates.push(email)
          }
        }
      }
      if (duplicates.length > 0) {
        return NextResponse.json({ error: `Already registered for this event: ${duplicates.join(', ')}` }, { status: 409 })
      }
    }

    // Create registration record
    const { data: registration, error: regError } = await db.from('registrations').insert({
      event_slug, event_title,
      type: 'group',
      status: 'pending',
      teacher_first_name: teacher.first_name,
      teacher_last_name: teacher.last_name,
      teacher_email: teacher.email,
      school_name: teacher.school_name,
      school_address_street: teacher.school_address_street,
      school_address_city: teacher.school_address_city,
      school_address_state: teacher.school_address_state,
      school_address_zip: teacher.school_address_zip,
      invoice_requested: payment_method === 'invoice',
      withdrawn_at: null,
    }).select('id').single()

    if (regError || !registration) {
      console.error('Registration insert error:', regError)
      return NextResponse.json({ error: 'Failed to create registration' }, { status: 500 })
    }

    const regId = (registration as Pick<RegistrationRow, 'id'>).id

    // Build participant rows
    const buildParticipant = (p: ParticipantPayload) => ({
      registration_id: regId,
      first_name: p.first_name, last_name: p.last_name,
      nickname: null as null,
      email: p.email, phone: p.phone,
      date_of_birth: p.date_of_birth,
      grade: p.grade ?? null,
      gender: p.gender,
      ethnicity: (p as { ethnicity?: string[] }).ethnicity ?? [],
      t_shirt_size: p.t_shirt_size,
      school_name: teacher.school_name as string,
      age_bracket: p.age_bracket,
      event_role: p.event_role,
      dietary_requirements: p.dietary_requirements ?? [],
      health_conditions: p.health_conditions || null,
      emergency_contact_first_name: p.emergency_contact_first_name || null,
      emergency_contact_last_name: p.emergency_contact_last_name || null,
      emergency_contact_email: p.emergency_contact_email || null,
      emergency_contact_phone: p.emergency_contact_phone || null,
    })

    // Teacher participant row
    const teacherRow = buildParticipant({
      first_name: teacher.first_name, last_name: teacher.last_name,
      email: teacher.email, phone: teacher.phone,
      date_of_birth: teacher.date_of_birth, gender: teacher.gender,
      t_shirt_size: teacher.t_shirt_size, age_bracket: teacher.age_bracket,
      event_role: 'Teacher',
      dietary_requirements: teacher.dietary_requirements,
      health_conditions: teacher.health_conditions,
    })

    const participantRows = [teacherRow]

    if (details_method === 'add_now') {
      for (const a of (additional_adults ?? [])) participantRows.push(buildParticipant(a))
      for (const s of (students ?? [])) participantRows.push(buildParticipant(s))
    }

    const { error: partError } = await db.from('participants').insert(participantRows)
    if (partError) {
      console.error('Participant insert error:', partError)
      await db.from('registrations').delete().eq('id', regId)
      return NextResponse.json({ error: 'Failed to save participant details' }, { status: 500 })
    }

    // ── Google Sheet (spreadsheet path) ──────────────────────────────────────
    let spreadsheetUrl: string | null = null
    if (details_method === 'spreadsheet') {
      if (isGoogleSheetsConfigured()) {
        try {
          spreadsheetUrl = await createGroupRegistrationSheet({
            eventTitle: event_title,
            schoolName: teacher.school_name,
            teacherEmail: teacher.email,
            additionalAdultCount: adult_count - 1,
            studentCount: student_count,
          })
        } catch (sheetErr) {
          console.error('Google Sheets error (non-fatal):', sheetErr)
        }
      } else {
        console.log('[group] Google Sheets not configured — skipping sheet creation')
      }
    }

    // ── Look up Stripe Price ID ───────────────────────────────────────────────
    const event = await getEventBySlug(event_slug)
    const stripePriceId = (event as { stripePriceId?: string } | null)?.stripePriceId
    const stripe = getStripe()

    let checkoutUrl: string | null = null

    if (payment_method === 'invoice' && stripePriceId && stripe) {
      try {
        // Create Stripe customer + invoice
        const customer = await stripe.customers.create({
          email: teacher.email,
          name: `${teacher.first_name} ${teacher.last_name}`,
          metadata: { registrationId: regId, eventSlug: event_slug },
        })

        // Retrieve price to get unit amount (v22 API no longer accepts price ID directly on invoiceItems)
        const priceObj = await stripe.prices.retrieve(stripePriceId)
        await stripe.invoiceItems.create({
          customer: customer.id,
          currency: priceObj.currency,
          amount: (priceObj.unit_amount ?? 0) * total_participants,
          description: `${event_title} — Group Registration (${total_participants} participant${total_participants !== 1 ? 's' : ''} × ${priceObj.currency.toUpperCase()} ${((priceObj.unit_amount ?? 0) / 100).toFixed(2)} each)`,
        })

        const invoice = await stripe.invoices.create({
          customer: customer.id,
          collection_method: 'send_invoice',
          days_until_due: 14,
          metadata: { registrationId: regId, eventSlug: event_slug, isGroup: 'true' },
        })

        const finalized = await stripe.invoices.finalizeInvoice(invoice.id)
        await stripe.invoices.sendInvoice(finalized.id)
      } catch (invoiceErr) {
        console.error('Stripe invoice error (non-fatal):', invoiceErr)
      }
    } else if (payment_method === 'card' && stripePriceId && stripe) {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ price: stripePriceId, quantity: total_participants }],
        client_reference_id: regId,
        customer_email: teacher.email,
        metadata: {
          registrationId: regId,
          eventSlug: event_slug,
          isGroup: 'true',
          teacherName: `${teacher.first_name} ${teacher.last_name}`,
        },
        success_url: spreadsheetUrl
          ? `${SITE_URL}/register/${event_slug}/confirmation?id=${regId}&type=group&payment=success&spreadsheet=${encodeURIComponent(spreadsheetUrl)}`
          : `${SITE_URL}/register/${event_slug}/confirmation?id=${regId}&type=group&payment=success`,
        cancel_url: `${SITE_URL}/register/${event_slug}/group?cancelled=true`,
      })
      checkoutUrl = session.url
    }

    // ── Confirmation email ────────────────────────────────────────────────────
    try {
      const emailContent = groupConfirmationEmail({
        teacherFirstName: teacher.first_name,
        teacherLastName: teacher.last_name,
        schoolName: teacher.school_name,
        eventTitle: event_title,
        participantCount: total_participants,
        registrationId: regId,
        paymentMethod: payment_method,
        spreadsheetUrl: spreadsheetUrl ?? undefined,
      })
      await sendEmail({ to: teacher.email, ...emailContent })
    } catch (emailErr) {
      console.error('Confirmation email failed (non-fatal):', emailErr)
    }

    return NextResponse.json({ registrationId: regId, checkoutUrl, spreadsheetUrl }, { status: 201 })
  } catch (e) {
    console.error('Group registration error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
