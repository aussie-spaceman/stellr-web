import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import { sendEmail, groupMemberJoinedEmail, groupMemberIndividualPaymentEmail } from '@/lib/email'
import { dispatchAgreement } from '@/lib/docusign-agreements'
import { linkMembersToSchoolByName } from '@/lib/school-link'
import { recordEventParticipation } from '@/lib/event-participation-sync'
import {
  normalizeEventRole, normalizeGender, normalizeGrade, normalizeTshirt,
} from '@/lib/member-enums'
import { ensureClerkUserAndSignInToken } from '@/lib/clerk-provisioning'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

// A participant, normalised to the enum/shape the participants + members tables
// and DocuSign expect — built either from the signed-in member's profile, or
// from the details a brand-new participant types on the join page.
interface JoinPerson {
  first_name: string
  last_name: string
  nickname: string | null
  email: string
  phone: string | null
  date_of_birth: string | null
  gender: string | null
  grade: string | null
  t_shirt_size: string | null
  age_bracket: string
  event_role: string
  ethnicity: string[]
  dietary_requirements: string[]
  health_conditions: string | null
  ec_first_name: string | null
  ec_last_name: string | null
  ec_email: string | null
  ec_phone: string | null
  ec_relationship: string | null
}

// POST /api/register/group-join — self-register via a join token.
//   • Signed-in members join with one click (their profile is authoritative).
//   • Brand-new participants submit { token, details } and are provisioned a
//     passwordless Clerk account + sign-in token, so they're auto-logged-in on
//     success — no detour through the (timeout-prone) hosted sign-in widget.
export async function POST(req: NextRequest) {
  const { userId } = await auth()
  const body = await req.json().catch(() => ({}))
  const { token, details } = body as { token?: string; details?: Record<string, unknown> }
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
  const eventSlug = tokenRow.event_slug as string
  const eventTitle = tokenRow.event_title as string
  const schoolName = (reg.school_name as string) ?? ''
  const memberPaysIndividually = (reg.member_pays_individually as boolean) ?? false

  let person: JoinPerson
  let memberId: string
  let signInToken: string | null = null

  if (userId) {
    // ── Signed-in member: their stored profile is authoritative ────────────────
    const { data: member } = await db
      .from('members')
      .select('id, first_name, last_name, nickname, email, phone, date_of_birth, gender, grade, tshirt_size, age_bracket, event_role, ec_first_name, ec_last_name, ec_email, ec_phone, ec_relationship')
      .eq('clerk_user_id', userId)
      .eq('is_active', true)
      .maybeSingle()

    if (!member) {
      return NextResponse.json({ error: 'Member profile not found. Please complete your Stellr profile first.' }, { status: 404 })
    }

    memberId = member.id
    person = {
      first_name: member.first_name,
      last_name: member.last_name,
      nickname: (member as { nickname?: string | null }).nickname ?? null,
      email: member.email,
      phone: member.phone ?? null,
      date_of_birth: member.date_of_birth ?? null,
      gender: member.gender ?? null,
      grade: member.grade ?? null,
      t_shirt_size: member.tshirt_size ?? null,
      age_bracket: member.age_bracket,
      event_role: normalizeEventRole(member.event_role ?? 'school_student'),
      ethnicity: [],
      dietary_requirements: [],
      health_conditions: null,
      ec_first_name: member.ec_first_name ?? null,
      ec_last_name: member.ec_last_name ?? null,
      ec_email: member.ec_email ?? null,
      ec_phone: member.ec_phone ?? null,
      ec_relationship: member.ec_relationship ?? null,
    }
  } else {
    // ── Brand-new participant: build from submitted details + provision Clerk ──
    if (!details) {
      return NextResponse.json({ error: 'Please complete your details to join.' }, { status: 400 })
    }
    const d = details as Record<string, string | string[] | undefined>
    const str = (v: unknown) => (v == null ? '' : String(v)).trim()
    const firstName = str(d.first_name)
    const lastName = str(d.last_name)
    const email = str(d.email).toLowerCase()
    const dob = str(d.date_of_birth)

    if (!firstName || !lastName || !email || !dob) {
      return NextResponse.json({ error: 'First name, last name, email and date of birth are required.' }, { status: 400 })
    }

    const ageNow = new Date().getFullYear() - new Date(dob).getFullYear()
    const isMinor = Number.isFinite(ageNow) && ageNow < 18
    const role = normalizeEventRole(str(d.type) || 'school_student')
    const eventRole = isMinor && role !== 'school_student_manager' ? 'school_student' : role

    person = {
      first_name: firstName,
      last_name: lastName,
      nickname: str(d.nickname) || null,
      email,
      phone: str(d.phone) || null,
      date_of_birth: dob,
      gender: normalizeGender(d.gender),
      grade: normalizeGrade(d.grade),
      t_shirt_size: normalizeTshirt(d.t_shirt_size),
      age_bracket: isMinor ? 'high_school' : 'adult',
      event_role: eventRole,
      ethnicity: Array.isArray(d.ethnicity) ? d.ethnicity : [],
      dietary_requirements: Array.isArray(d.dietary_requirements) ? d.dietary_requirements : [],
      health_conditions: str(d.health_conditions) || null,
      ec_first_name: str(d.emergency_contact_first_name) || null,
      ec_last_name: str(d.emergency_contact_last_name) || null,
      ec_email: str(d.emergency_contact_email) || null,
      ec_phone: str(d.emergency_contact_phone) || null,
      ec_relationship: str(d.emergency_contact_relationship) || null,
    }

    // Upsert the member row (by email) so they get an account, school link, and
    // admin visibility — same contract as the registration routes.
    const { data: memberRow, error: memberErr } = await db
      .from('members')
      .upsert({
        email: person.email,
        first_name: person.first_name,
        last_name: person.last_name,
        nickname: person.nickname,
        phone: person.phone,
        date_of_birth: person.date_of_birth,
        gender: person.gender,
        grade: person.grade,
        tshirt_size: person.t_shirt_size,
        age_bracket: person.age_bracket,
        event_role: person.event_role,
        is_active: true,
        health_conditions: person.health_conditions,
        ec_first_name: person.ec_first_name,
        ec_last_name: person.ec_last_name,
        ec_email: person.ec_email,
        ec_phone: person.ec_phone,
        ec_relationship: person.ec_relationship,
      }, { onConflict: 'email', ignoreDuplicates: false })
      .select('id')
      .maybeSingle()

    if (memberErr || !memberRow) {
      console.error('Group join member upsert error:', memberErr)
      return NextResponse.json({ error: 'Failed to create your member account. Please try again.' }, { status: 500 })
    }
    memberId = memberRow.id

    // Provision a passwordless Clerk account + sign-in token so the participant
    // is silently signed in on success (non-fatal — they can still sign in later
    // with the same email). Eagerly link the Clerk id to avoid a webhook race.
    try {
      const provisioned = await ensureClerkUserAndSignInToken(person.email, person.first_name, person.last_name)
      signInToken = provisioned.signInToken
      await db.from('members').update({ clerk_user_id: provisioned.clerkUserId }).eq('id', memberId)
    } catch (clerkErr) {
      console.error('Clerk provisioning for group-join (non-fatal):', clerkErr)
    }
  }

  // Already in this registration?
  const { data: existing } = await db
    .from('participants')
    .select('id')
    .eq('registration_id', registrationId)
    .eq('email', person.email)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'You are already registered in this group.' }, { status: 409 })
  }

  // Cap at the declared group size. Once every place the organiser nominated is
  // filled, the link stops accepting NEW people (the dedupe above still lets an
  // already-registered member re-open the link harmlessly). Registrations created
  // before migration 037 have null counts → no cap, preserving old behaviour.
  const declaredAdults = reg.adult_count as number | null
  const declaredStudents = reg.student_count as number | null
  if (declaredAdults != null && declaredStudents != null) {
    const { count: currentCount } = await db
      .from('participants')
      .select('*', { count: 'exact', head: true })
      .eq('registration_id', registrationId)
    if ((currentCount ?? 0) >= declaredAdults + declaredStudents) {
      return NextResponse.json({
        error: 'This group is already full — every place the organiser registered has been filled. Please contact your organiser if you think this is a mistake.',
      }, { status: 409 })
    }
  }

  const paymentStatus = memberPaysIndividually ? 'pending' : null

  // Insert participant row
  const { data: partRow, error: partError } = await db.from('participants').insert({
    registration_id: registrationId,
    member_id: memberId,
    first_name: person.first_name,
    last_name: person.last_name,
    nickname: null,
    email: person.email,
    phone: person.phone ?? '',
    date_of_birth: person.date_of_birth,
    grade: person.grade ?? null,
    gender: person.gender,
    ethnicity: [],
    t_shirt_size: person.t_shirt_size ?? '',
    school_name: schoolName,
    age_bracket: person.age_bracket,
    event_role: person.event_role,
    dietary_requirements: person.dietary_requirements,
    health_conditions: person.health_conditions,
    emergency_contact_first_name: person.ec_first_name,
    emergency_contact_last_name: person.ec_last_name,
    emergency_contact_email: person.ec_email,
    emergency_contact_phone: person.ec_phone,
    emergency_contact_relationship: person.ec_relationship,
    individual_payment_status: paymentStatus,
    join_completed_at: new Date().toISOString(),
  }).select('id').single()

  if (partError || !partRow) {
    console.error('Group join participant insert error:', partError)
    return NextResponse.json({ error: 'Failed to complete registration. Please try again.' }, { status: 500 })
  }

  // Link the joining member to the group's school so it surfaces in
  // /admin/schools and on their member page — not just as participant text.
  await linkMembersToSchoolByName(db, [memberId], {
    name: schoolName || null,
    address_street: (reg.school_address_street as string) || null,
    address_city: (reg.school_address_city as string) || null,
    address_state: (reg.school_address_state as string) || null,
    address_zip: (reg.school_address_zip as string) || null,
  })

  // Record the event in the joining member's Event Activity (event_participations).
  await recordEventParticipation(db, { memberId, eventSlug, eventTitle })

  // Trigger the appropriate DocuSign agreement (minor consent, or self-signed
  // adult/mentor participation agreement) based on the participant's age and role.
  await dispatchAgreement(db, {
    participantId:     partRow.id,
    memberId,
    eventSlug,
    eventTitle,
    firstName:         person.first_name,
    lastName:          person.last_name,
    email:             person.email,
    phone:             person.phone ?? undefined,
    dateOfBirth:       person.date_of_birth ?? undefined,
    eventRole:         person.event_role,
    schoolName:        schoolName || undefined,
    schoolState:       (reg.school_address_state as string) || undefined,
    guardianFirstName: person.ec_first_name ?? undefined,
    guardianLastName:  person.ec_last_name ?? undefined,
    guardianEmail:     person.ec_email ?? undefined,
    guardianPhone:     person.ec_phone ?? undefined,
    relationship:      person.ec_relationship ?? undefined,
  })

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
      memberFirstName: person.first_name,
      memberLastName: person.last_name,
      memberEmail: person.email,
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
          customer_email: person.email,
          metadata: {
            registrationId,
            eventSlug,
            participantEmail: person.email,
            isIndividualGroupPayment: 'true',
          },
          success_url: `${SITE_URL}/register/${eventSlug}/confirmation?id=${registrationId}&type=group&payment=success`,
          cancel_url: `${SITE_URL}/register/${eventSlug}/join/${token}?cancelled=true`,
        })

        if (session.url) {
          const payContent = groupMemberIndividualPaymentEmail({
            memberFirstName: person.first_name,
            memberLastName: person.last_name,
            eventTitle,
            registrationId,
            paymentUrl: session.url,
          })
          await sendEmail({ to: person.email, ...payContent })
        }
      } catch (stripeErr) {
        console.error('Individual payment session error (non-fatal):', stripeErr)
      }
    }
  }

  return NextResponse.json({ success: true, eventSlug, eventTitle, signInToken }, { status: 201 })
}
