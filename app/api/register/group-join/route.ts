import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import { sendEmail, groupMemberJoinedEmail, groupMemberIndividualPaymentEmail, docusignSentToMinorEmail } from '@/lib/email'
import { createConsentEnvelope, isMinor } from '@/lib/docusign'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

// POST /api/register/group-join — authenticated member self-registers via a join token
export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const { token } = await req.json()
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })

  const db = supabaseServer()

  // Validate token
  const { data: tokenRow, error: tokenError } = await db
    .from('group_join_tokens')
    .select('*, registrations(*)')
    .eq('token', token)
    .maybeSingle()

  if (tokenError || !tokenRow) {
    return NextResponse.json({ error: 'Invalid or expired registration link' }, { status: 404 })
  }
  if (new Date(tokenRow.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This registration link has expired' }, { status: 410 })
  }

  const reg = tokenRow.registrations as Record<string, unknown>
  const registrationId = tokenRow.registration_id as string

  // Load the member record
  const { data: member } = await db
    .from('members')
    .select('id, first_name, last_name, email, phone, date_of_birth, gender, grade, tshirt_size, age_bracket, event_role, ec_first_name, ec_last_name, ec_email, ec_phone')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (!member) {
    return NextResponse.json({ error: 'Member profile not found. Please complete your Stellr profile first.' }, { status: 404 })
  }

  // Check not already in this registration
  const { data: existing } = await db
    .from('participants')
    .select('id')
    .eq('registration_id', registrationId)
    .eq('email', member.email)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'You are already registered in this group.' }, { status: 409 })
  }

  // Determine age bracket and role (do not override existing role)
  const eventSlug = tokenRow.event_slug as string
  const eventTitle = tokenRow.event_title as string
  const memberPaysIndividually = (reg.member_pays_individually as boolean) ?? false

  const paymentStatus = memberPaysIndividually ? 'pending' : null

  // Insert participant row
  const { data: partRow, error: partError } = await db.from('participants').insert({
    registration_id: registrationId,
    member_id: member.id,
    first_name: member.first_name,
    last_name: member.last_name,
    nickname: null,
    email: member.email,
    phone: member.phone ?? '',
    date_of_birth: member.date_of_birth,
    grade: member.grade ?? null,
    gender: member.gender,
    ethnicity: [],
    t_shirt_size: member.tshirt_size ?? '',
    school_name: (reg.school_name as string) ?? '',
    age_bracket: member.age_bracket,
    event_role: 'School Student',
    dietary_requirements: [],
    health_conditions: null,
    emergency_contact_first_name: member.ec_first_name ?? null,
    emergency_contact_last_name: member.ec_last_name ?? null,
    emergency_contact_email: member.ec_email ?? null,
    emergency_contact_phone: member.ec_phone ?? null,
    individual_payment_status: paymentStatus,
    join_completed_at: new Date().toISOString(),
  }).select('id').single()

  if (partError || !partRow) {
    console.error('Group join participant insert error:', partError)
    return NextResponse.json({ error: 'Failed to complete registration. Please try again.' }, { status: 500 })
  }

  // Trigger DocuSign consent for minor group members
  if (isMinor(member.date_of_birth ?? '') && member.ec_email && member.ec_first_name) {
    const guardianName = [member.ec_first_name, member.ec_last_name].filter(Boolean).join(' ')
    try {
      const envelopeId = await createConsentEnvelope({
        minorFirstName:  member.first_name,
        minorLastName:   member.last_name,
        minorDateOfBirth: member.date_of_birth ?? undefined,
        guardianName,
        guardianEmail:   member.ec_email,
        guardianPhone:   member.ec_phone ?? undefined,
        eventTitle,
        schoolName:      (reg.school_name as string) || undefined,
        schoolState:     (reg.school_address_state as string) || undefined,
      })
      await db.from('docusign_envelopes').insert({
        participant_id: partRow.id,
        member_id:      member.id,
        event_slug:     eventSlug,
        event_title:    eventTitle,
        envelope_id:    envelopeId,
        status:         'sent',
        signer_name:    guardianName,
        signer_email:   member.ec_email,
        minor_name:     `${member.first_name} ${member.last_name}`,
      })
      await sendEmail({
        to: member.email,
        ...docusignSentToMinorEmail({ firstName: member.first_name, guardianName, guardianEmail: member.ec_email, eventTitle }),
      })
    } catch (dsErr) {
      console.error('[docusign] Group join envelope creation failed (non-fatal):', dsErr)
    }
  }

  // Count total members who have completed their join
  const { count: joinedCount } = await db
    .from('participants')
    .select('*', { count: 'exact', head: true })
    .eq('registration_id', registrationId)
    .not('join_completed_at', 'is', null)

  const totalExpected = ((reg.adult_count as number) ?? 1) + ((reg.student_count as number) ?? 2)

  // Notify registrant
  const registrantEmail = reg.teacher_email as string
  const registrantFirstName = reg.teacher_first_name as string
  const ccEmails: string[] = reg.teacher_poc_email ? [reg.teacher_poc_email as string] : []

  try {
    const notifContent = groupMemberJoinedEmail({
      registrantFirstName,
      memberFirstName: member.first_name,
      memberLastName: member.last_name,
      memberEmail: member.email,
      eventTitle,
      memberCount: joinedCount ?? 1,
      totalExpected,
    })
    await sendEmail({ to: registrantEmail, cc: ccEmails, ...notifContent })
  } catch (emailErr) {
    console.error('Join notification email error (non-fatal):', emailErr)
  }

  // If individual payment, create Stripe checkout and send to member
  if (memberPaysIndividually) {
    const stripe = getStripe()
    const event = await getEventBySlug(eventSlug)
    const stripePriceId = (event as { stripePriceId?: string } | null)?.stripePriceId

    if (stripe && stripePriceId) {
      try {
        const session = await stripe.checkout.sessions.create({
          mode: 'payment',
          line_items: [{ price: stripePriceId, quantity: 1 }],
          customer_email: member.email,
          metadata: {
            registrationId,
            eventSlug,
            participantEmail: member.email,
            isIndividualGroupPayment: 'true',
          },
          success_url: `${SITE_URL}/register/${eventSlug}/confirmation?id=${registrationId}&type=group&payment=success`,
          cancel_url: `${SITE_URL}/register/${eventSlug}/join/${token}?cancelled=true`,
        })

        if (session.url) {
          const payContent = groupMemberIndividualPaymentEmail({
            memberFirstName: member.first_name,
            memberLastName: member.last_name,
            eventTitle,
            registrationId,
            paymentUrl: session.url,
          })
          await sendEmail({ to: member.email, ...payContent })
        }
      } catch (stripeErr) {
        console.error('Individual payment session error (non-fatal):', stripeErr)
      }
    }
  }

  return NextResponse.json({ success: true, eventSlug, eventTitle }, { status: 201 })
}
