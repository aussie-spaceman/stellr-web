import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import type { RegistrationRow } from '@/lib/database.types'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      event_slug, event_title,
      teacher_first_name, teacher_last_name, teacher_email,
      school_name, school_address_street, school_address_city,
      school_address_state, school_address_zip,
      participants,
    } = body

    if (!event_slug || !teacher_email || !participants || participants.length < 2) {
      return NextResponse.json({ error: 'Missing required fields or fewer than 2 participants' }, { status: 400 })
    }

    const db = supabaseServer()

    // Duplicate check: any participant email already registered for this event
    const emails: string[] = participants.map((p: { email: string }) => p.email)

    // For each email, check if they have a registration for this event
    const duplicateEmails: string[] = []
    for (const email of emails) {
      const { data: participant } = await db
        .from('participants')
        .select('registration_id')
        .eq('email', email)
        .maybeSingle()

      if (participant) {
        const { data: reg } = await db
          .from('registrations')
          .select('event_slug')
          .eq('id', (participant as { registration_id: string }).registration_id)
          .maybeSingle()

        if (reg && (reg as Pick<RegistrationRow, 'event_slug'>).event_slug === event_slug) {
          duplicateEmails.push(email)
        }
      }
    }

    if (duplicateEmails.length > 0) {
      return NextResponse.json(
        { error: `The following email(s) are already registered for this event: ${duplicateEmails.join(', ')}` },
        { status: 409 }
      )
    }

    // Create registration record
    const { data: registration, error: regError } = await db
      .from('registrations')
      .insert({
        event_slug,
        event_title,
        type: 'group',
        status: 'pending',
        teacher_first_name, teacher_last_name, teacher_email,
        school_name, school_address_street, school_address_city,
        school_address_state, school_address_zip,
        invoice_requested: true,
        withdrawn_at: null,
      })
      .select('id')
      .single()

    if (regError || !registration) {
      console.error('Registration insert error:', regError)
      return NextResponse.json({ error: 'Failed to create registration' }, { status: 500 })
    }

    const regId = (registration as Pick<RegistrationRow, 'id'>).id

    // Build participant rows
    const participantRows = participants.map((p: {
      first_name: string; last_name: string; email: string; phone: string
      date_of_birth: string; grade: string; gender: string; t_shirt_size: string
      emergency_contact_first_name: string; emergency_contact_last_name: string
      emergency_contact_email: string; emergency_contact_phone: string
      health_conditions?: string
    }) => {
      const age = Math.floor((Date.now() - new Date(p.date_of_birth).getTime()) / (365.25 * 24 * 3600 * 1000))
      const hsGrades = ['9', '10', '11', '12']
      const age_bracket = age < 18 || hsGrades.includes(p.grade) ? 'High School'
        : p.grade.startsWith('College') || p.grade === 'Grad / PhD' ? 'College'
        : 'Adult'

      return {
        registration_id: regId,
        first_name: p.first_name, last_name: p.last_name, nickname: null,
        email: p.email, phone: p.phone,
        date_of_birth: p.date_of_birth, grade: p.grade, gender: p.gender,
        ethnicity: [], t_shirt_size: p.t_shirt_size,
        school_name, age_bracket, event_role: 'School Student',
        dietary_requirements: [],
        health_conditions: p.health_conditions || null,
        emergency_contact_first_name: p.emergency_contact_first_name,
        emergency_contact_last_name: p.emergency_contact_last_name,
        emergency_contact_email: p.emergency_contact_email,
        emergency_contact_phone: p.emergency_contact_phone,
      }
    })

    const { error: partError } = await db.from('participants').insert(participantRows)

    if (partError) {
      console.error('Participant insert error:', partError)
      await db.from('registrations').delete().eq('id', regId)
      return NextResponse.json({ error: 'Failed to save participant details' }, { status: 500 })
    }

    // TODO: send confirmation email to teacher_email via Resend
    // TODO: trigger invoice generation

    return NextResponse.json({ registrationId: regId }, { status: 201 })
  } catch (e) {
    console.error('Group registration error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
