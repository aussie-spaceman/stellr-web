import { randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getEventBySlug } from '@/lib/sanity'
import { stripeClient } from '@/lib/stripe'
import { createGroupRegistrationSheet, isGoogleSheetsConfigured, type SheetSeedRow } from '@/lib/google-sheets'
import { groupConfirmationEmail, sendEmail } from '@/lib/email'
import { createAndSendGroupInvoice, findGroupInvoice } from '@/lib/group-invoice'
import { runGroupRegistrationFollowUp, type FollowUpPerson } from '@/lib/group-registration-followup'
import { formatUsd } from '@/lib/mentoring-format'
import { checkInCodeLink } from '@/lib/check-in-codes'

// "Finish registration setup" (admin): completes a group registration whose
// request was cut off after the records were written — on 28 Oct 2026 a team of
// 18 was saved, but the organiser got no Google Sheet, join link, invoice or
// confirmation email, and half the team no agreement. Each step checks what
// already exists first, so running it twice never sends a second invoice or
// creates a second sheet. The admin picks which steps run, from a preview.

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
const STUDENT_ROLES = new Set(['participant', 'school_student_manager'])

export type SetupStep = 'sheet' | 'join_link' | 'invoice' | 'confirmation' | 'follow_up'
export const SETUP_STEPS: SetupStep[] = ['sheet', 'join_link', 'invoice', 'confirmation', 'follow_up']

export interface SetupPreviewItem {
  step: SetupStep
  /** True when the step has something to do; the UI pre-ticks these. */
  needed: boolean
  summary: string
}

type Reg = {
  id: string; type: string; status: string; event_slug: string; event_title: string | null
  teacher_first_name: string | null; teacher_last_name: string | null; teacher_email: string | null
  teacher_poc_email: string | null; teacher_member_id: string | null; school_name: string | null
  school_address_state: string | null; spreadsheet_id: string | null; invoice_requested: boolean | null
  invoice_paid_at: string | null; amount_due_cents: number | null; member_pays_individually: boolean | null
  details_method: string | null; adult_count: number | null; student_count: number | null
  registrant_role: string | null
}
type Part = {
  id: string; member_id: string | null; first_name: string; last_name: string; email: string | null
  phone: string | null; date_of_birth: string | null; event_role: string | null; school_name: string | null
  grade: string | null; gender: string | null; t_shirt_size: string | null; dietary_requirements: string[] | null
  health_conditions: string | null; emergency_contact_first_name: string | null; emergency_contact_last_name: string | null
  emergency_contact_email: string | null; emergency_contact_phone: string | null; emergency_contact_relationship: string | null
}

async function load(db: SupabaseClient, registrationId: string) {
  const { data: reg } = await db
    .from('registrations')
    .select(`id, type, status, event_slug, event_title, teacher_first_name, teacher_last_name, teacher_email,
      teacher_poc_email, teacher_member_id, school_name, school_address_state, spreadsheet_id, invoice_requested,
      invoice_paid_at, amount_due_cents, member_pays_individually, details_method, adult_count, student_count,
      registrant_role`)
    .eq('id', registrationId)
    .maybeSingle()
  if (!reg || (reg as Reg).type !== 'group') return null
  const { data: parts } = await db
    .from('participants')
    .select(`id, member_id, first_name, last_name, email, phone, date_of_birth, event_role, school_name, grade, gender,
      t_shirt_size, dietary_requirements, health_conditions, emergency_contact_first_name, emergency_contact_last_name,
      emergency_contact_email, emergency_contact_phone, emergency_contact_relationship`)
    .eq('registration_id', registrationId)
    .order('created_at', { ascending: true })
  return { reg: reg as Reg, parts: (parts ?? []) as Part[] }
}

const isOrganiser = (reg: Reg, p: Part) => !!reg.teacher_member_id && p.member_id === reg.teacher_member_id

export async function previewGroupSetup(db: SupabaseClient, registrationId: string): Promise<SetupPreviewItem[] | null> {
  const loaded = await load(db, registrationId)
  if (!loaded) return null
  const { reg, parts } = loaded

  const { count: tokens } = await db
    .from('group_join_tokens')
    .select('token', { count: 'exact', head: true })
    .eq('registration_id', registrationId)

  let invoice: SetupPreviewItem
  if (!reg.invoice_requested) {
    invoice = { step: 'invoice', needed: false, summary: 'Not paying by invoice.' }
  } else if (reg.invoice_paid_at) {
    invoice = { step: 'invoice', needed: false, summary: 'Invoice already paid.' }
  } else {
    const stripe = stripeClient()
    const existing = stripe ? await findGroupInvoice(stripe, registrationId).catch(() => null) : null
    invoice = existing
      ? { step: 'invoice', needed: false, summary: `Invoice already in Stripe (${existing.status}).` }
      : stripe
        ? { step: 'invoice', needed: true, summary: `No invoice found. Will send ${reg.amount_due_cents ? formatUsd(reg.amount_due_cents) : 'the group fee'} to ${reg.teacher_email}.` }
        : { step: 'invoice', needed: false, summary: 'Stripe is not configured here.' }
  }

  const { data: agreementRows } = await db
    .from('agreements')
    .select('participant_id')
    .in('participant_id', parts.map((p) => p.id))
  const withAgreement = new Set((agreementRows ?? []).map((a) => (a as { participant_id: string }).participant_id))
  const noAgreement = parts.filter((p) => !withAgreement.has(p.id)).length
  const memberIds = parts.filter((p) => p.member_id && !isOrganiser(reg, p)).map((p) => p.member_id as string)
  const { data: noLogin } = memberIds.length
    ? await db.from('members').select('id').in('id', memberIds).is('clerk_user_id', null).is('account_invite_sent_at', null)
    : { data: [] }
  const loginsOwed = (noLogin ?? []).length

  return [
    reg.spreadsheet_id
      ? { step: 'sheet', needed: false, summary: 'Google Sheet already created.' }
      : isGoogleSheetsConfigured()
        ? { step: 'sheet', needed: true, summary: 'No Google Sheet yet. Will create one, seeded with the people already entered.' }
        : { step: 'sheet', needed: false, summary: 'Google Sheets is not configured here.' },
    (tokens ?? 0) > 0
      ? { step: 'join_link', needed: false, summary: 'Join link already created.' }
      : { step: 'join_link', needed: true, summary: 'No join link yet. Will create one (valid 30 days).' },
    invoice,
    {
      step: 'confirmation',
      needed: !reg.spreadsheet_id || (tokens ?? 0) === 0,
      summary: `Email the confirmation (with sheet and join link) to ${reg.teacher_email}${reg.teacher_poc_email ? `, cc ${reg.teacher_poc_email}` : ''}.`,
    },
    {
      step: 'follow_up',
      needed: noAgreement > 0 || loginsOwed > 0,
      summary: `Agreements for ${noAgreement} without one; account emails to ${loginsOwed} without a login (under-13s wait for consent); the organiser's clearance notice if still owed.`,
    },
  ]
}

export async function finishGroupSetup(
  db: SupabaseClient,
  registrationId: string,
  steps: SetupStep[],
): Promise<Record<string, string> | null> {
  const loaded = await load(db, registrationId)
  if (!loaded) return null
  const { reg, parts } = loaded
  const want = new Set(steps)
  const out: Record<string, string> = {}
  const eventTitle = reg.event_title ?? reg.event_slug
  const teacher = {
    email: reg.teacher_email ?? '',
    firstName: reg.teacher_first_name ?? '',
    lastName: reg.teacher_last_name ?? '',
  }
  const others = parts.filter((p) => !isOrganiser(reg, p))

  let spreadsheetUrl: string | null = reg.spreadsheet_id ? `https://docs.google.com/spreadsheets/d/${reg.spreadsheet_id}/edit` : null
  if (want.has('sheet')) {
    if (reg.spreadsheet_id) out.sheet = 'already existed'
    else if (!isGoogleSheetsConfigured()) out.sheet = 'skipped: not configured'
    else {
      try {
        const seed = (p: Part): SheetSeedRow => ({
          type: STUDENT_ROLES.has(p.event_role ?? '') ? 'Student' : p.event_role === 'teacher' ? 'Teacher' : 'Adult',
          first_name: p.first_name ?? '', last_name: p.last_name ?? '', email: p.email ?? '', phone: p.phone ?? '',
          date_of_birth: p.date_of_birth ?? '', gender: p.gender ?? '', t_shirt_size: p.t_shirt_size ?? '',
          grade: p.grade ?? '', dietary_requirements: p.dietary_requirements ?? [], health_conditions: p.health_conditions ?? '',
          ec_first_name: p.emergency_contact_first_name ?? '', ec_last_name: p.emergency_contact_last_name ?? '',
          ec_email: p.emergency_contact_email ?? '', ec_phone: p.emergency_contact_phone ?? '',
          ec_relationship: p.emergency_contact_relationship ?? '',
        })
        const enteredStudents = others.filter((p) => STUDENT_ROLES.has(p.event_role ?? '')).length
        const enteredAdults = others.length - enteredStudents
        const declaredAdults = reg.registrant_role === 'student_manager' ? (reg.adult_count ?? 0) : Math.max(0, (reg.adult_count ?? 0) - 1)
        const sheet = await createGroupRegistrationSheet({
          eventTitle,
          schoolName: reg.school_name ?? '',
          teacherEmail: teacher.email,
          additionalAdultCount: Math.max(0, declaredAdults - enteredAdults),
          studentCount: Math.max(0, (reg.student_count ?? 0) - enteredStudents),
          enteredParticipants: others.map(seed),
        })
        await db.from('registrations').update({ spreadsheet_id: sheet.spreadsheetId }).eq('id', reg.id)
        spreadsheetUrl = sheet.url
        out.sheet = 'created'
      } catch (err) {
        console.error('[group-setup] sheet failed:', err)
        out.sheet = `failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  let joinUrl: string | null = null
  const { data: tokenRow } = await db
    .from('group_join_tokens')
    .select('token')
    .eq('registration_id', reg.id)
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (tokenRow?.token) joinUrl = `${SITE_URL}/register/${reg.event_slug}/join/${tokenRow.token}`
  if (want.has('join_link')) {
    if (joinUrl) out.join_link = 'already existed'
    else {
      const token = randomBytes(32).toString('hex')
      const { error } = await db.from('group_join_tokens').insert({
        token,
        registration_id: reg.id,
        event_slug: reg.event_slug,
        event_title: eventTitle,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      })
      if (error) out.join_link = `failed: ${error.message}`
      else {
        joinUrl = `${SITE_URL}/register/${reg.event_slug}/join/${token}`
        out.join_link = 'created'
      }
    }
  }

  if (want.has('invoice')) {
    const stripe = stripeClient()
    if (!reg.invoice_requested) out.invoice = 'skipped: not paying by invoice'
    else if (reg.invoice_paid_at) out.invoice = 'skipped: already paid'
    else if (!stripe) out.invoice = 'skipped: Stripe not configured'
    else if (!reg.amount_due_cents || reg.amount_due_cents <= 0) out.invoice = 'skipped: no amount due recorded'
    else {
      try {
        const existing = await findGroupInvoice(stripe, reg.id)
        if (existing) out.invoice = `already existed (${existing.status})`
        else {
          const event = await getEventBySlug(reg.event_slug)
          const priceId = (event as { stripePriceId?: string } | null)?.stripePriceId
          const price = priceId ? await stripe.prices.retrieve(priceId) : null
          const total = parts.length
          await createAndSendGroupInvoice(db, stripe, {
            registrationId: reg.id,
            eventSlug: reg.event_slug,
            eventTitle,
            teacher,
            registrantMemberId: reg.teacher_member_id,
            amountCents: reg.amount_due_cents,
            perSeatCents: price?.unit_amount ?? Math.round(reg.amount_due_cents / Math.max(1, total)),
            currency: price?.currency ?? 'usd',
            totalParticipants: total,
          })
          out.invoice = 'sent'
        }
      } catch (err) {
        console.error('[group-setup] invoice failed:', err)
        out.invoice = `failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  if (want.has('confirmation')) {
    try {
      const content = groupConfirmationEmail({
        teacherFirstName: teacher.firstName,
        teacherLastName: teacher.lastName,
        schoolName: reg.school_name ?? '',
        eventTitle,
        participantCount: (reg.adult_count ?? 0) + (reg.student_count ?? 0) || parts.length,
        registrationId: reg.id,
        paymentMethod: reg.invoice_requested ? 'invoice' : reg.member_pays_individually ? 'individual' : 'card',
        detailsMethod: (reg.details_method as 'add_now' | 'spreadsheet' | 'email_link' | null) ?? 'add_now',
        spreadsheetUrl: spreadsheetUrl ?? undefined,
        joinUrl: joinUrl ?? undefined,
        checkInCodeUrl: checkInCodeLink(reg.event_slug, 'g', reg.id) ?? undefined,
      })
      await sendEmail({ to: teacher.email, cc: reg.teacher_poc_email ? [reg.teacher_poc_email] : [], ...content })
      out.confirmation = 'sent'
    } catch (err) {
      console.error('[group-setup] confirmation failed:', err)
      out.confirmation = `failed: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  if (want.has('follow_up')) {
    const event = await getEventBySlug(reg.event_slug).catch(() => null)
    const people: FollowUpPerson[] = parts.map((p) => ({
      isRegistrant: isOrganiser(reg, p),
      agreement: {
        participantId: p.id,
        memberId: p.member_id,
        eventSlug: reg.event_slug,
        eventTitle,
        firstName: p.first_name,
        lastName: p.last_name,
        email: p.email ?? '',
        phone: p.phone,
        dateOfBirth: p.date_of_birth,
        eventRole: p.event_role,
        schoolName: p.school_name ?? reg.school_name,
        schoolState: reg.school_address_state,
        guardianFirstName: p.emergency_contact_first_name,
        guardianLastName: p.emergency_contact_last_name,
        guardianEmail: p.emergency_contact_email,
        guardianPhone: p.emergency_contact_phone,
        relationship: p.emergency_contact_relationship,
        grade: p.grade,
      },
    }))
    const result = await runGroupRegistrationFollowUp(db, {
      eventSlug: reg.event_slug,
      eventTitle,
      eventDate: (event as { date?: string | null } | null)?.date ?? null,
      organiserName: `${teacher.firstName} ${teacher.lastName}`.trim() || 'Your teacher',
      people,
      deadline: Date.now() + 240_000,
    })
    const fmt = (o: Record<string, number>) => Object.entries(o).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'
    out.follow_up = `agreements: ${fmt(result.agreements)}; accounts: ${fmt(result.invites)}; clearance: ${result.clearance}` +
      (result.deferred.agreements || result.deferred.invites
        ? `; deferred to the daily sweep: ${result.deferred.agreements} agreements, ${result.deferred.invites} accounts`
        : '')
  }

  return out
}
