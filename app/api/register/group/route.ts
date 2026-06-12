import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import {
  sendEmail,
  groupConfirmationEmail,
  groupMemberIndividualPaymentEmail,
} from '@/lib/email'
import { createGroupRegistrationSheet, isGoogleSheetsConfigured } from '@/lib/google-sheets'
import { ensureClerkUserAndSignInToken } from '@/lib/clerk-provisioning'
import { dispatchAgreement } from '@/lib/docusign-agreements'
import { normalizeGender, normalizeAgeBracket, normalizeEventRole, normalizeGrade, normalizeTshirt } from '@/lib/member-enums'
import { linkMembersToSchoolByName } from '@/lib/school-link'
import { recordEventParticipation } from '@/lib/event-participation-sync'
import { syncMemberOptionSelections } from '@/lib/member-profile-options'
import { getCurrentMember } from '@/lib/community'
import type { RegistrationRow } from '@/lib/database.types'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

// The "minor → school_student" override must never strip an organiser of their
// role. A teacher / student-manager keeps it regardless of DOB — a test or
// mistyped birthdate previously downgraded the registrant to school_student,
// which hid their own group from /account?tab=teams and 403'd team management.
// Everyone else (students, additional adults, mentors) follows the age rule.
const ORGANISER_ROLES = new Set(['teacher', 'school_student_manager'])
function resolveRoleForAge(rawRole: unknown, ageNow: number): string {
  const role = normalizeEventRole(rawRole)
  if (ORGANISER_ROLES.has(role)) return role
  return Number.isFinite(ageNow) && ageNow < 18 ? 'school_student' : role
}

interface ParticipantPayload {
  first_name: string; last_name: string; email: string; phone: string
  date_of_birth: string; grade?: string; gender: string; t_shirt_size: string
  age_bracket: string; event_role: string
  dietary_requirements?: string[]; health_conditions?: string
  emergency_contact_first_name?: string; emergency_contact_last_name?: string
  emergency_contact_email?: string; emergency_contact_phone?: string
  emergency_contact_relationship?: string
}

interface TeacherPoC {
  first_name: string; last_name: string; email: string
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      event_slug, event_title,
      registrant_role = 'teacher',
      teacher,
      teacher_poc,
      adult_count, student_count, total_participants,
      details_method = 'add_now',
      payment_method,
      member_pays_individually = false,
      additional_adults,
      students,
      school_dpa_agreed,
    } = body

    // Option A — when the registrant (teacher / student-manager) is signed in,
    // their session email is authoritative. This keeps the registrant bound to
    // their own member row and avoids duplicate/forged identities. Additional
    // adults and students are unaffected — group logic is otherwise unchanged.
    const sessionMember = await getCurrentMember().catch(() => null)
    if (sessionMember?.email && teacher) {
      teacher.email = sessionMember.email
    }

    if (!event_slug || !teacher?.email || !teacher?.first_name || !teacher?.last_name) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (!school_dpa_agreed) {
      return NextResponse.json({ error: 'You must accept the School Data Processing Agreement to continue' }, { status: 400 })
    }
    if (student_count < 2) {
      return NextResponse.json({ error: 'A minimum of 2 students is required' }, { status: 400 })
    }
    if (registrant_role === 'student_manager' && !teacher_poc?.email) {
      return NextResponse.json({ error: 'Student managers must nominate a teacher point of contact' }, { status: 400 })
    }

    const db = supabaseServer()

    // Duplicate check: registrant email
    const { data: existingRegistrant } = await db
      .from('participants')
      .select('registration_id')
      .eq('email', teacher.email)
      .maybeSingle()

    if (existingRegistrant) {
      const { data: reg } = await db.from('registrations').select('event_slug')
        .eq('id', (existingRegistrant as { registration_id: string }).registration_id).maybeSingle()
      if (reg && (reg as Pick<RegistrationRow, 'event_slug'>).event_slug === event_slug) {
        return NextResponse.json({ error: 'This email address is already registered for this event.' }, { status: 409 })
      }
    }

    // Duplicate check: participant emails (add_now only) — two batched queries
    if (details_method === 'add_now') {
      const allEmails: string[] = [
        ...(additional_adults ?? []).map((a: ParticipantPayload) => a.email),
        ...(students ?? []).map((s: ParticipantPayload) => s.email),
      ]
      if (allEmails.length > 0) {
        const { data: existingParticipants } = await db
          .from('participants')
          .select('email, registration_id')
          .in('email', allEmails)
        const regIds = [...new Set((existingParticipants ?? []).map(p => p.registration_id))]
        if (regIds.length > 0) {
          const { data: sameEventRegs } = await db
            .from('registrations')
            .select('id')
            .in('id', regIds)
            .eq('event_slug', event_slug)
          const conflictRegIds = new Set((sameEventRegs ?? []).map(r => r.id))
          const duplicates = [...new Set(
            (existingParticipants ?? [])
              .filter(p => conflictRegIds.has(p.registration_id))
              .map(p => p.email)
          )]
          if (duplicates.length > 0) {
            return NextResponse.json({ error: `Already registered for this event: ${duplicates.join(', ')}` }, { status: 409 })
          }
        }
      }
    }

    const poc = teacher_poc as TeacherPoC | null

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
      registrant_role,
      teacher_poc_first_name: poc?.first_name ?? null,
      teacher_poc_last_name: poc?.last_name ?? null,
      teacher_poc_email: poc?.email ?? null,
      member_pays_individually,
      details_method,
      withdrawn_at: null,
      school_dpa_agreed_at: new Date().toISOString(),
    }).select('id').single()

    if (regError || !registration) {
      console.error('Registration insert error:', regError)
      return NextResponse.json({ error: 'Failed to create registration' }, { status: 500 })
    }

    const regId = (registration as Pick<RegistrationRow, 'id'>).id

    // Upsert all known participants into members table
    const allPeople: ParticipantPayload[] = details_method === 'add_now' ? [
      { ...teacher, event_role: registrant_role === 'student_manager' ? 'school_student_manager' : 'teacher' },
      ...(additional_adults ?? []),
      ...(students ?? []),
    ] : [
      { ...teacher, event_role: registrant_role === 'student_manager' ? 'school_student_manager' : 'teacher' },
    ]

    // Batch-upsert everyone in one round-trip; dedupe in-batch emails (last wins,
    // matching the previous serial loop) since Postgres rejects ON CONFLICT
    // updates that touch the same row twice in one statement.
    const memberUpsertByEmail = new Map<string, Record<string, unknown>>()
    const optionsByEmail = new Map<string, { ethnicity?: string[]; dietary?: string[] }>()
    for (const p of allPeople) {
      const dob = new Date(p.date_of_birth)
      const ageNow = new Date().getFullYear() - dob.getFullYear()
      optionsByEmail.set(p.email, {
        ethnicity: (p as { ethnicity?: string[] }).ethnicity,
        dietary: p.dietary_requirements,
      })
      memberUpsertByEmail.set(p.email, {
        email: p.email,
        first_name: p.first_name,
        last_name: p.last_name,
        phone: p.phone,
        date_of_birth: p.date_of_birth,
        gender: normalizeGender(p.gender),
        grade: normalizeGrade(p.grade),
        tshirt_size: normalizeTshirt(p.t_shirt_size),
        age_bracket: ageNow < 18 ? 'high_school' : normalizeAgeBracket(p.age_bracket),
        event_role: resolveRoleForAge(p.event_role, ageNow),
        is_active: true,
        // Persist the profile so each member doesn't re-enter it next time (028).
        // Emergency contact goes to the members table's canonical ec_* columns —
        // the same ones /account, admin, and group-join read (029). Ethnicity and
        // dietary go to the member_ethnicities/member_allergies join tables below
        // for the same reason (030).
        health_conditions: p.health_conditions || null,
        ec_first_name: p.emergency_contact_first_name || null,
        ec_last_name: p.emergency_contact_last_name || null,
        ec_email: p.emergency_contact_email || null,
        ec_phone: p.emergency_contact_phone || null,
        ec_relationship: p.emergency_contact_relationship || null,
      })
    }

    const memberIdMap: Record<string, string | null> = {}
    const { data: memberRows, error: memberUpsertError } = await db
      .from('members')
      .upsert([...memberUpsertByEmail.values()], { onConflict: 'email', ignoreDuplicates: false })
      .select('id, email')
    if (memberUpsertError) {
      console.error('Member upsert error (non-fatal — participants still created):', memberUpsertError)
    }

    for (const row of memberRows ?? []) {
      memberIdMap[row.email] = row.id
    }

    // Resolve the group's school to a schools row and link every member to it,
    // so the school surfaces in /admin/schools and on each member page — not
    // just as free text on the registration/participant rows.
    await linkMembersToSchoolByName(db, Object.values(memberIdMap), {
      name: teacher.school_name,
      address_street: teacher.school_address_street ?? null,
      address_city: teacher.school_address_city ?? null,
      address_state: teacher.school_address_state ?? null,
      address_zip: teacher.school_address_zip ?? null,
    })

    // Record the event in each member's Event Activity (event_participations),
    // so the group registration surfaces on their member/portal pages — not
    // just on the event roster. Non-fatal, idempotent per (member, event).
    await Promise.all(
      Object.values(memberIdMap).map((memberId) =>
        recordEventParticipation(db, { memberId, eventSlug: event_slug, eventTitle: event_title })
      )
    )

    // Persist each member's ethnicity/dietary selections onto the canonical
    // join tables (030) — same non-fatal contract as school linking.
    await syncMemberOptionSelections(
      db,
      [...optionsByEmail].map(([email, sel]) =>
        memberIdMap[email] ? { memberId: memberIdMap[email]!, ...sel } : null
      )
    )

    // Link registrant's member ID to the registration (enables portal team management)
    const registrantMemberId = memberIdMap[teacher.email]
    if (registrantMemberId) {
      await db.from('registrations').update({ teacher_member_id: registrantMemberId }).eq('id', regId)
    }

    // Provision a Clerk account + sign-in token so the registrant is silently
    // signed in on the confirmation step and can immediately open their group's
    // sheet from the member portal — no manual sign-up required. Non-fatal: a
    // Clerk hiccup must not fail the registration.
    // Already-signed-in registrants don't need provisioning or a sign-in token —
    // they have a Clerk session (and clerk_user_id) already.
    let signInToken: string | null = null
    if (!sessionMember) {
      try {
        const provisioned = await ensureClerkUserAndSignInToken(
          teacher.email, teacher.first_name, teacher.last_name,
        )
        signInToken = provisioned.signInToken
        // Eagerly link the Clerk id to the member row (the user.created webhook
        // also does this, but we can't rely on its timing for the immediate
        // ownership check on the sheet endpoint).
        if (registrantMemberId) {
          await db.from('members').update({ clerk_user_id: provisioned.clerkUserId }).eq('id', registrantMemberId)
        }
      } catch (clerkErr) {
        console.error('Clerk provisioning (non-fatal):', clerkErr)
      }
    }

    // Build participant rows. event_role is normalised to the enum values the
    // admin roster, Companies auto-assign, and check-in filter on — same
    // under-18 override as the members upsert above.
    const buildParticipant = (p: ParticipantPayload, paymentStatus?: 'pending' | null) => ({
      registration_id: regId,
      member_id: memberIdMap[p.email] ?? null,
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
      event_role: resolveRoleForAge(
        p.event_role,
        new Date().getFullYear() - new Date(p.date_of_birth).getFullYear(),
      ),
      dietary_requirements: p.dietary_requirements ?? [],
      health_conditions: p.health_conditions || null,
      emergency_contact_first_name: p.emergency_contact_first_name || null,
      emergency_contact_last_name: p.emergency_contact_last_name || null,
      emergency_contact_email: p.emergency_contact_email || null,
      emergency_contact_phone: p.emergency_contact_phone || null,
      emergency_contact_relationship: p.emergency_contact_relationship || null,
      individual_payment_status: paymentStatus ?? null,
    })

    const registrantPayStatus: 'pending' | null =
      member_pays_individually && details_method === 'add_now' ? 'pending' : null
    const registrantRow = buildParticipant({
      first_name: teacher.first_name, last_name: teacher.last_name,
      email: teacher.email, phone: teacher.phone,
      date_of_birth: teacher.date_of_birth, gender: teacher.gender,
      t_shirt_size: teacher.t_shirt_size, age_bracket: teacher.age_bracket,
      event_role: registrant_role === 'student_manager' ? 'school_student_manager' : 'teacher',
      dietary_requirements: teacher.dietary_requirements,
      health_conditions: teacher.health_conditions,
      grade: teacher.grade ?? undefined,
      emergency_contact_first_name: teacher.emergency_contact_first_name,
      emergency_contact_last_name: teacher.emergency_contact_last_name,
      emergency_contact_email: teacher.emergency_contact_email,
      emergency_contact_phone: teacher.emergency_contact_phone,
      emergency_contact_relationship: teacher.emergency_contact_relationship,
    }, registrantPayStatus)

    const participantRows = [registrantRow]

    if (details_method === 'add_now') {
      const payStatus = member_pays_individually ? 'pending' : null
      for (const a of (additional_adults ?? [])) participantRows.push(buildParticipant(a, payStatus))
      for (const s of (students ?? [])) participantRows.push(buildParticipant(s, payStatus))
    }

    const { data: insertedParts, error: partError } = await db
      .from('participants')
      .insert(participantRows)
      .select('id, email')
    if (partError) {
      console.error('Participant insert error:', partError)
      await db.from('registrations').delete().eq('id', regId)
      return NextResponse.json({ error: 'Failed to save participant details' }, { status: 500 })
    }

    // ── DocuSign agreements for everyone entered now ──────────────────────────
    // Each participant gets the right document by age/role: minors → parental
    // consent, adult attendees → Adult agreement, mentors → Mentor agreement.
    // Sequential to avoid DocuSign rate limits; all calls are non-fatal.
    const partIdByEmail = new Map((insertedParts ?? []).map(r => [r.email, r.id]))
    for (const row of participantRows) {
      const participantId = partIdByEmail.get(row.email)
      if (!participantId) continue
      await dispatchAgreement(db, {
        participantId,
        memberId:          row.member_id,
        eventSlug:         event_slug,
        eventTitle:        event_title,
        firstName:         row.first_name,
        lastName:          row.last_name,
        email:             row.email,
        phone:             row.phone,
        dateOfBirth:       row.date_of_birth,
        eventRole:         row.event_role,
        schoolName:        row.school_name,
        schoolState:       teacher.school_address_state,
        guardianFirstName: row.emergency_contact_first_name,
        guardianLastName:  row.emergency_contact_last_name,
        guardianEmail:     row.emergency_contact_email,
        guardianPhone:     row.emergency_contact_phone,
        relationship:      row.emergency_contact_relationship,
      })
    }

    // ── Google Sheet (every group registration gets a linked sheet) ────────────
    // Created up front so the teacher/student-manager can always open it from the
    // member portal, regardless of the details method they chose on the form.
    let spreadsheetUrl: string | null = null
    if (isGoogleSheetsConfigured()) {
      try {
        const adultCountForSheet = registrant_role === 'student_manager'
          ? adult_count          // all adults are "additional" for SM
          : adult_count - 1      // exclude teacher from additional adult count
        const sheet = await createGroupRegistrationSheet({
          eventTitle: event_title,
          schoolName: teacher.school_name,
          teacherEmail: teacher.email,
          additionalAdultCount: adultCountForSheet,
          studentCount: student_count,
        })
        spreadsheetUrl = sheet.url
        // Persist the sheet ID so the portal "Open Sheet" link, sheet-sync, and the
        // Google Drive change webhook can all resolve back to this exact sheet.
        await db.from('registrations').update({ spreadsheet_id: sheet.spreadsheetId }).eq('id', regId)
      } catch (sheetErr) {
        console.error('Google Sheets error (non-fatal):', sheetErr)
      }
    } else {
      console.log('[group] Google Sheets not configured — skipping sheet creation')
    }

    // ── Group join token (spreadsheet or email_link path — both get a token) ──
    let joinUrl: string | null = null
    if (details_method === 'spreadsheet' || details_method === 'email_link') {
      const token = randomBytes(32).toString('hex')
      const { error: tokenError } = await db.from('group_join_tokens').insert({
        token,
        registration_id: regId,
        event_slug,
        event_title,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      })
      if (!tokenError) {
        joinUrl = `${SITE_URL}/register/${event_slug}/join/${token}`
      } else {
        console.error('Group join token insert error (non-fatal):', tokenError)
      }
    }

    // The sheet is created for every group, but it's only an *action item* (and so
    // surfaced as an option in the confirmation email / page) when members weren't
    // entered up front. For add_now the sheet is just a portal record.
    const promptSpreadsheetUrl = details_method === 'add_now' ? null : spreadsheetUrl

    // ── Look up Stripe Price ID ───────────────────────────────────────────────
    const event = await getEventBySlug(event_slug)
    const stripePriceId = (event as { stripePriceId?: string } | null)?.stripePriceId
    const stripe = getStripe()

    let checkoutUrl: string | null = null

    if (payment_method === 'invoice' && stripePriceId && stripe) {
      try {
        const customer = await stripe.customers.create({
          email: teacher.email,
          name: `${teacher.first_name} ${teacher.last_name}`,
          metadata: { registrationId: regId, eventSlug: event_slug },
        })
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
        success_url: promptSpreadsheetUrl
          ? `${SITE_URL}/register/${event_slug}/confirmation?id=${regId}&type=group&payment=success&spreadsheet=${encodeURIComponent(promptSpreadsheetUrl)}`
          : `${SITE_URL}/register/${event_slug}/confirmation?id=${regId}&type=group&payment=success`,
        cancel_url: `${SITE_URL}/register/${event_slug}/group?cancelled=true`,
      })
      checkoutUrl = session.url
    } else if (member_pays_individually && details_method === 'add_now' && stripePriceId && stripe) {
      // Create individual checkout sessions for every participant, including the
      // registrant — their own seat must be billed too when members pay individually.
      const memberParticipants: ParticipantPayload[] = [
        teacher as ParticipantPayload,
        ...(additional_adults ?? []),
        ...(students ?? []),
      ]
      await Promise.all(memberParticipants.map(async (p) => {
        try {
          const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            line_items: [{ price: stripePriceId, quantity: 1 }],
            customer_email: p.email,
            metadata: {
              registrationId: regId,
              eventSlug: event_slug,
              participantEmail: p.email,
              isIndividualGroupPayment: 'true',
            },
            success_url: `${SITE_URL}/register/${event_slug}/confirmation?id=${regId}&type=group&payment=success`,
            cancel_url: `${SITE_URL}/register/${event_slug}/group?cancelled=true`,
          })
          if (session.url) {
            const emailContent = groupMemberIndividualPaymentEmail({
              memberFirstName: p.first_name,
              memberLastName: p.last_name,
              eventTitle: event_title,
              registrationId: regId,
              paymentUrl: session.url,
            })
            await sendEmail({ to: p.email, ...emailContent })
          }
        } catch (indErr) {
          console.error(`Individual payment session error for ${p.email} (non-fatal):`, indErr)
        }
      }))
    }

    // ── CC list for confirmation emails ───────────────────────────────────────
    const ccEmails: string[] = []
    if (poc?.email) ccEmails.push(poc.email)

    // ── Confirmation email (includes both spreadsheet + join link when available) ─
    try {
      const emailContent = groupConfirmationEmail({
        teacherFirstName: teacher.first_name,
        teacherLastName: teacher.last_name,
        schoolName: teacher.school_name,
        eventTitle: event_title,
        participantCount: total_participants,
        registrationId: regId,
        paymentMethod: payment_method,
        detailsMethod: details_method,
        spreadsheetUrl: promptSpreadsheetUrl ?? undefined,
        joinUrl: joinUrl ?? undefined,
      })
      await sendEmail({ to: teacher.email, cc: ccEmails, ...emailContent })
    } catch (emailErr) {
      console.error('Confirmation email failed (non-fatal):', emailErr)
    }

    return NextResponse.json({ registrationId: regId, checkoutUrl, spreadsheetUrl: promptSpreadsheetUrl, signInToken }, { status: 201 })
  } catch (e) {
    console.error('Group registration error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
