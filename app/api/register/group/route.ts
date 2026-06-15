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
import { createGroupRegistrationSheet, isGoogleSheetsConfigured, type SheetSeedRow } from '@/lib/google-sheets'
import { ensureClerkUserAndSignInToken } from '@/lib/clerk-provisioning'
import { dispatchAgreement } from '@/lib/docusign-agreements'
import { normalizeGender, normalizeAgeBracket, normalizeEventRole, normalizeGrade, normalizeTshirt, normalizeEmail } from '@/lib/member-enums'
import { linkMembersToSchoolByName } from '@/lib/school-link'
import { recordEventParticipation } from '@/lib/event-participation-sync'
import { syncMemberOptionSelections } from '@/lib/member-profile-options'
import { getMemberOnFileByMembershipId } from '@/lib/member-onfile'
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
  first_name: string; last_name: string; nickname?: string; email: string; phone: string
  date_of_birth: string; grade?: string; gender: string; t_shirt_size: string
  age_bracket: string; event_role: string
  ethnicity?: string[]; dietary_requirements?: string[]; health_conditions?: string
  emergency_contact_first_name?: string; emergency_contact_last_name?: string
  emergency_contact_email?: string; emergency_contact_phone?: string
  emergency_contact_relationship?: string
  // Member-ID linking (organiser entered an existing Stellr Member ID + Accept).
  linked?: boolean
  existing_membership_id?: string
  // Set during server-side resolution — the linked member's id. When present the
  // participant is built from the on-file record and the member is NOT overwritten.
  _linked_member_id?: string | null
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
      content_tier,
    } = body

    // Validate the optional competition content tier (decision D3 — bought once
    // per group). Unknown values are ignored rather than failing the registration.
    const purchasedContentTier: string | null =
      ['baseline', 'advanced', 'premium'].includes(content_tier) ? content_tier : null

    // Option A — when the registrant (teacher / student-manager) is signed in,
    // their session email is authoritative. This keeps the registrant bound to
    // their own member row and avoids duplicate/forged identities. Additional
    // adults and students are unaffected — group logic is otherwise unchanged.
    const sessionMember = await getCurrentMember().catch(() => null)
    if (sessionMember?.email && teacher) {
      teacher.email = sessionMember.email
    }

    // Email is the member dedup key — normalise the registrant's and every
    // participant's address up front so casing never spawns a duplicate member
    // (and so the duplicate-check queries below compare like-for-like).
    if (teacher?.email) teacher.email = normalizeEmail(teacher.email)
    for (const p of (additional_adults ?? [])) if (p?.email) p.email = normalizeEmail(p.email)
    for (const p of (students ?? [])) if (p?.email) p.email = normalizeEmail(p.email)

    if (!event_slug || !teacher?.email || !teacher?.first_name || !teacher?.last_name) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    // A school is mandatory — it drives school linking, the DocuSign SchoolName
    // tab, and FERPA scoping. The form gates on this too, but enforce it here so
    // the school can never be silently blank (which left DocuSign school empty).
    if (!teacher?.school_name || !teacher.school_name.trim()) {
      return NextResponse.json({ error: 'Please select or add your school before registering.' }, { status: 400 })
    }
    if (!school_dpa_agreed) {
      return NextResponse.json({ error: 'You must accept the School Data Processing Agreement to continue' }, { status: 400 })
    }
    // A group needs at least 2 students. For a Student Manager that count is
    // "other students" — the SM is student #1 — so 1 other (2 total) is the floor.
    const minOtherStudents = registrant_role === 'student_manager' ? 1 : 2
    if (student_count < minOtherStudents) {
      return NextResponse.json({ error: 'A minimum of 2 students is required' }, { status: 400 })
    }
    if (registrant_role === 'student_manager' && !teacher_poc?.email) {
      return NextResponse.json({ error: 'Student managers must nominate a teacher point of contact' }, { status: 400 })
    }

    const db = supabaseServer()

    // Resolve any member-ID-linked participants to their on-file record. The
    // organiser only typed a Member ID + "Accept", so the rest of the slot is
    // blank — fill it from the member's stored profile and stamp the resolved
    // member id so the email-keyed upsert below skips them (the member is reused,
    // never overwritten — the real fix for the silent overwrite/duplicate bug).
    // Falls back to manual handling if the ID no longer resolves.
    if (details_method === 'add_now') {
      const resolveLinked = async (people: ParticipantPayload[] | undefined) => {
        for (const p of people ?? []) {
          if (!p.linked || !p.existing_membership_id) continue
          const onFile = await getMemberOnFileByMembershipId(db, p.existing_membership_id)
          if (!onFile) { p.linked = false; continue }
          p.first_name = onFile.first_name
          p.last_name = onFile.last_name
          p.nickname = onFile.nickname ?? undefined
          p.email = onFile.email
          p.phone = onFile.phone ?? ''
          p.date_of_birth = onFile.date_of_birth ?? ''
          p.grade = onFile.grade ?? undefined
          p.gender = onFile.gender ?? ''
          p.t_shirt_size = onFile.t_shirt_size ?? ''
          p.ethnicity = onFile.ethnicity
          p.dietary_requirements = onFile.dietary_requirements
          p.health_conditions = onFile.health_conditions ?? undefined
          p.emergency_contact_first_name = onFile.emergency_contact_first_name ?? undefined
          p.emergency_contact_last_name = onFile.emergency_contact_last_name ?? undefined
          p.emergency_contact_email = onFile.emergency_contact_email ?? undefined
          p.emergency_contact_phone = onFile.emergency_contact_phone ?? undefined
          p.emergency_contact_relationship = onFile.emergency_contact_relationship ?? undefined
          p._linked_member_id = onFile.memberId
        }
      }
      await resolveLinked(additional_adults)
      await resolveLinked(students)
    }

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

    // Declared group size, normalised to ABSOLUTE totals so adult_count +
    // student_count == total participants regardless of role. For a teacher the
    // form's adult_count already includes them; for a student-manager the SM is the
    // group's first student, so add 1 to the "other students" count.
    const declaredAdultCount = adult_count
    const declaredStudentCount = registrant_role === 'student_manager' ? 1 + student_count : student_count

    // Create registration record
    const { data: registration, error: regError } = await db.from('registrations').insert({
      event_slug, event_title,
      type: 'group',
      status: 'pending',
      content_tier: purchasedContentTier,
      adult_count: declaredAdultCount,
      student_count: declaredStudentCount,
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
    const linkedMemberIdByEmail = new Map<string, string>()
    for (const p of allPeople) {
      // Member-ID-linked participants reuse their existing record — never re-upsert
      // (which would overwrite their profile) or re-sync their options. Just keep
      // their id so the participant row below links to them.
      if (p._linked_member_id) {
        if (p.email) linkedMemberIdByEmail.set(p.email, p._linked_member_id)
        continue
      }
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
        nickname: p.nickname || null,
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
    // Seed linked participants' member ids up front (they were skipped above).
    for (const [email, id] of linkedMemberIdByEmail) memberIdMap[email] = id
    const { data: memberRows, error: memberUpsertError } = memberUpsertByEmail.size > 0
      ? await db
          .from('members')
          .upsert([...memberUpsertByEmail.values()], { onConflict: 'email', ignoreDuplicates: false })
          .select('id, email')
      : { data: [], error: null }
    if (memberUpsertError) {
      console.error('Member upsert error (non-fatal — participants still created):', memberUpsertError)
    }

    for (const row of memberRows ?? []) {
      memberIdMap[row.email] = row.id
    }

    // Guarantee the registrant's member row. The batched upsert above can drop
    // *everyone* if a single row violates an enum/date constraint — and if the
    // registrant is among the dropped, teacher_member_id never gets set and the
    // Clerk link is skipped, so the organiser lands on a portal that 403s every
    // team action and shows no teams. Re-upsert the registrant alone (their own
    // payload, so a bad teammate row can't block them) to recover that case.
    if (!memberIdMap[teacher.email]) {
      const registrantPayload = memberUpsertByEmail.get(teacher.email)
      if (registrantPayload) {
        const { data: soloRow, error: soloErr } = await db
          .from('members')
          .upsert(registrantPayload, { onConflict: 'email', ignoreDuplicates: false })
          .select('id')
          .maybeSingle()
        if (soloErr) console.error('Registrant solo upsert error (non-fatal):', soloErr)
        if (soloRow?.id) memberIdMap[teacher.email] = soloRow.id
      }
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
    // Free Baseline unlocks content access immediately; paid Advanced/Premium
    // are applied on payment confirmation (Stripe webhook → applyCampaignContentTier).
    const creationContentTier = purchasedContentTier === 'baseline' ? 'baseline' : null
    await Promise.all(
      Object.values(memberIdMap).map((memberId) =>
        recordEventParticipation(db, {
          memberId,
          eventSlug: event_slug,
          eventTitle: event_title,
          contentTier: creationContentTier,
        })
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
      nickname: p.nickname || null,
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
      nickname: teacher.nickname,
      email: teacher.email, phone: teacher.phone,
      date_of_birth: teacher.date_of_birth, gender: teacher.gender,
      t_shirt_size: teacher.t_shirt_size, age_bracket: teacher.age_bracket,
      event_role: registrant_role === 'student_manager' ? 'school_student_manager' : 'teacher',
      ethnicity: teacher.ethnicity,
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

        // Seed the sheet with anyone already entered on the web form (greyed +
        // read-only), and leave blank rows only for the REMAINDER. The registrant
        // is captured directly and never appears in the sheet, so the universe
        // (and the entered subset) both exclude them. For the spreadsheet /
        // email-link methods nothing was entered now, so this seeds nothing and
        // the whole roster stays blank — unchanged behaviour.
        const seedFromPayload = (p: ParticipantPayload, type: SheetSeedRow['type']): SheetSeedRow => ({
          type,
          first_name: p.first_name ?? '', last_name: p.last_name ?? '',
          email: p.email ?? '', phone: p.phone ?? '',
          date_of_birth: p.date_of_birth ?? '',
          gender: p.gender ?? '', t_shirt_size: p.t_shirt_size ?? '', grade: p.grade ?? '',
          dietary_requirements: p.dietary_requirements ?? [],
          health_conditions: p.health_conditions ?? '',
          ec_first_name: p.emergency_contact_first_name ?? '', ec_last_name: p.emergency_contact_last_name ?? '',
          ec_email: p.emergency_contact_email ?? '', ec_phone: p.emergency_contact_phone ?? '',
          ec_relationship: p.emergency_contact_relationship ?? '',
        })
        const enteredParticipants: SheetSeedRow[] = details_method === 'add_now'
          ? [
              ...(additional_adults ?? []).map((p: ParticipantPayload) =>
                seedFromPayload(p, p.event_role === 'Teacher' ? 'Teacher' : 'Adult')),
              ...(students ?? []).map((p: ParticipantPayload) => seedFromPayload(p, 'Student')),
            ]
          : []
        const enteredAdults = details_method === 'add_now' ? (additional_adults ?? []).length : 0
        const enteredStudents = details_method === 'add_now' ? (students ?? []).length : 0

        const sheet = await createGroupRegistrationSheet({
          eventTitle: event_title,
          schoolName: teacher.school_name,
          teacherEmail: teacher.email,
          additionalAdultCount: Math.max(0, adultCountForSheet - enteredAdults),
          studentCount: Math.max(0, student_count - enteredStudents),
          enteredParticipants,
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

    // Did the organiser leave some declared slots for later? For add_now we
    // compare what they actually entered against the declared group size. (For
    // the spreadsheet / email-link methods the whole roster is provided later.)
    const expectedAdditionalAdults = registrant_role === 'student_manager'
      ? adult_count                       // SM: all adults are "additional" (PoC + optional)
      : Math.max(0, adult_count - 1)      // teacher: exclude themselves
    const providedAdditionalAdults = (additional_adults ?? []).length
    const providedStudents = (students ?? []).length
    const incompleteAddNow = details_method === 'add_now' &&
      (providedAdditionalAdults < expectedAdditionalAdults || providedStudents < student_count)
    // How many declared people were left for later — drives the "X still to add"
    // messaging on the confirmation page and email. Only meaningful for a partial
    // add_now; the spreadsheet / email-link methods provide the whole roster later.
    const remainingCount = incompleteAddNow
      ? Math.max(0, expectedAdditionalAdults - providedAdditionalAdults) + Math.max(0, student_count - providedStudents)
      : 0

    // ── Group join token ──────────────────────────────────────────────────────
    // A forwardable completion link is created for the spreadsheet / email-link
    // methods, and also for an add_now registration that was only partially filled
    // — so the organiser (or each member) can finish the remaining people later.
    let joinUrl: string | null = null
    if (details_method === 'spreadsheet' || details_method === 'email_link' || incompleteAddNow) {
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
    // surfaced in the confirmation email / page) when members still need entering —
    // the spreadsheet / email-link methods, or a partially-filled add_now.
    const promptSpreadsheetUrl = details_method !== 'add_now' || incompleteAddNow ? spreadsheetUrl : null

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
        // Persist the Stripe customer on the registrant's member row so the
        // invoice (and its receipt) surfaces in /account?tab=billing, which
        // lists invoices via members.stripe_customer_id. Without this the
        // invoice exists in Stripe but is invisible to the member.
        if (registrantMemberId) {
          await db.from('members').update({ stripe_customer_id: customer.id }).eq('id', registrantMemberId)
        }
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
        // Always mint a Customer so the receipt is retrievable in the billing tab
        // (the webhook persists session.customer onto the member row).
        customer_creation: 'always',
        metadata: {
          registrationId: regId,
          eventSlug: event_slug,
          isGroup: 'true',
          teacherName: `${teacher.first_name} ${teacher.last_name}`,
        },
        success_url: (() => {
          const u = new URL(`${SITE_URL}/register/${event_slug}/confirmation`)
          u.searchParams.set('id', regId); u.searchParams.set('type', 'group'); u.searchParams.set('payment', 'success')
          if (promptSpreadsheetUrl) u.searchParams.set('spreadsheet', promptSpreadsheetUrl)
          if (incompleteAddNow && joinUrl) u.searchParams.set('join', joinUrl)
          if (remainingCount > 0) u.searchParams.set('remaining', String(remainingCount))
          return u.toString()
        })(),
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

    // ── Content-tier checkout ─────────────────────────────────────────────────
    // Campaigns are free to join, so a paid Advanced/Premium content tier is
    // charged on its own (no event-fee checkout to piggyback on). On payment the
    // Stripe webhook confirms the registration → applyCampaignContentTier cascades
    // the tier to participants and fires the Premium → Pathfinder grant.
    if (!checkoutUrl && (purchasedContentTier === 'advanced' || purchasedContentTier === 'premium') && stripe) {
      const offerings =
        (event as { contentTierOfferings?: { tier: string; priceUsd?: number }[] } | null)
          ?.contentTierOfferings ?? []
      const cents = Math.round(
        (offerings.find((o) => o.tier === purchasedContentTier)?.priceUsd ?? 0) * 100,
      )
      if (cents > 0) {
        try {
          const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            line_items: [
              {
                price_data: {
                  currency: 'usd',
                  unit_amount: cents,
                  product_data: { name: `${event_title} — ${purchasedContentTier} content tier` },
                },
                quantity: 1,
              },
            ],
            client_reference_id: regId,
            customer_email: teacher.email,
            customer_creation: 'always',
            metadata: {
              registrationId: regId,
              eventSlug: event_slug,
              isGroup: 'true',
              contentTier: purchasedContentTier,
            },
            success_url: (() => {
              const u = new URL(`${SITE_URL}/register/${event_slug}/confirmation`)
              u.searchParams.set('id', regId)
              u.searchParams.set('type', 'group')
              u.searchParams.set('payment', 'success')
              if (promptSpreadsheetUrl) u.searchParams.set('spreadsheet', promptSpreadsheetUrl)
              if (incompleteAddNow && joinUrl) u.searchParams.set('join', joinUrl)
              return u.toString()
            })(),
            cancel_url: `${SITE_URL}/register/${event_slug}/group?cancelled=true`,
          })
          checkoutUrl = session.url
        } catch (ctErr) {
          console.error('Content-tier checkout error (non-fatal):', ctErr)
        }
      }
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
        remainingCount,
      })
      await sendEmail({ to: teacher.email, cc: ccEmails, ...emailContent })
    } catch (emailErr) {
      console.error('Confirmation email failed (non-fatal):', emailErr)
    }

    return NextResponse.json({ registrationId: regId, checkoutUrl, spreadsheetUrl: promptSpreadsheetUrl, joinUrl, signInToken }, { status: 201 })
  } catch (e) {
    console.error('Group registration error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
