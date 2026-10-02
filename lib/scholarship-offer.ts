import type { SupabaseClient } from '@supabase/supabase-js'
import { getEventBySlug } from '@/lib/sanity'
import { stripeClient } from '@/lib/stripe'
import { sendEmail } from '@/lib/email'
import { logActivity } from '@/lib/activity-log'
import { formatDateRange } from '@/lib/utils'
import { findExistingRegistrations } from '@/lib/registration-duplicates'
import { pendingAddonLines } from '@/lib/registration-checkout'
import { confirmRegistration } from '@/lib/registration-confirm'
import {
  issueScholarshipRefund,
  scholarshipRefundFor,
  type ScholarshipRefundMethod,
  type ScholarshipRefundResult,
} from '@/lib/scholarship-refund'
import {
  SCHOLARSHIP_COLUMNS,
  attachOfferToRegistration,
  discountedCents,
  mintOfferToken,
  scholarshipOfferUrl,
  scholarshipRegisterUrl,
  scholarshipStage,
  type ScholarshipApplication,
  type ScholarshipPercent,
} from '@/lib/scholarships'
import {
  scholarshipDetailsEmail,
  scholarshipOfferEmail,
  scholarshipPaymentEmail,
  type OfferEmailInput,
} from '@/lib/scholarship-emails'

// Making an offer: the one write path behind "Offer & register" in the admin
// review page (and the backfill script). It links the student's member record,
// attaches any registration they already have, records the decision, and sends
// the three offer emails.
//
// "Registered" here follows the mentor precedent (#181): the member row exists
// at once, and the student completes their own details. The registration row
// itself is created by the ordinary individual form when they do — a
// participant row cannot exist without DOB, gender, school and the rest, and
// every roster, CSV and badge reader relies on that. Until then the roster
// shows the offer as "awaiting details" from this table.

export interface Reviewer {
  clerkUserId: string | null
  /** The reviewer's own member id — recorded as decided_by on a refund. */
  memberId: string | null
  name: string | null
}

export interface OfferInput {
  applicationId: string
  percent: ScholarshipPercent
  eventSlug: string
  /** An existing member chosen by the reviewer; otherwise matched or created by the application email. */
  memberId?: string | null
  reviewer: Reviewer
  sendEmails: boolean
  /** Already paid (retrospective case): reimburse to the card (default) or as account credit. */
  refundMethod?: ScholarshipRefundMethod
}

export type OfferResult =
  | {
      ok: true
      application: ScholarshipApplication
      registrationId: string | null
      emailedTo: string[]
      /** Set when the student had already paid. */
      refund: ScholarshipRefundResult | null
    }
  | { ok: false; status: number; error: string }

interface MemberLite {
  id: string
  email: string
  first_name: string
}

async function loadApplication(db: SupabaseClient, id: string): Promise<ScholarshipApplication | null> {
  const { data } = await db.from('scholarship_applications').select(SCHOLARSHIP_COLUMNS).eq('id', id).maybeSingle()
  return (data as ScholarshipApplication | null) ?? null
}

/** The member an application belongs to: chosen, matched by email, or created. */
async function resolveMember(
  db: SupabaseClient,
  app: ScholarshipApplication,
  chosenId: string | null | undefined,
): Promise<MemberLite | { error: string; status: number }> {
  if (chosenId) {
    const { data } = await db.from('members').select('id, email, first_name').eq('id', chosenId).is('deleted_at', null).maybeSingle()
    return (data as MemberLite | null) ?? { error: 'That member no longer exists', status: 404 }
  }
  const email = app.email.trim().toLowerCase()
  const { data: existing } = await db
    .from('members')
    .select('id, email, first_name')
    .ilike('email', email)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (existing) return existing as MemberLite
  // The application email is the student's own address (owner, 2 Oct 2026),
  // so the new member is the student: a school participant until their
  // registration says otherwise.
  const { data: created, error } = await db
    .from('members')
    .insert({
      first_name: app.first_name.trim(),
      last_name: app.last_name.trim(),
      email,
      phone: app.phone || null,
      age_bracket: 'high_school',
      event_role: 'participant',
      is_active: true,
    })
    .select('id, email, first_name')
    .single()
  if (error || !created) {
    console.error('[scholarship] member create failed:', error)
    return { error: 'Could not create the student’s member record', status: 500 }
  }
  return created as MemberLite
}

async function eventFeeCents(stripePriceId: string | undefined): Promise<number | null> {
  const stripe = stripeClient()
  if (!stripePriceId || !stripe) return null
  try {
    const price = await stripe.prices.retrieve(stripePriceId)
    return price.unit_amount ?? null
  } catch (e) {
    console.error('[scholarship] event price lookup failed (non-fatal):', e)
    return null
  }
}

export async function offerScholarship(db: SupabaseClient, input: OfferInput): Promise<OfferResult> {
  const app = await loadApplication(db, input.applicationId)
  if (!app) return { ok: false, status: 404, error: 'Application not found' }
  if (app.status !== 'submitted') return { ok: false, status: 409, error: `This application is already ${app.status.replace('_', ' ')}` }

  const event = await getEventBySlug(input.eventSlug).catch(() => null)
  if (!event) return { ok: false, status: 400, error: 'Choose an event for this scholarship' }

  const member = await resolveMember(db, app, input.memberId)
  if ('error' in member) return { ok: false, status: member.status, error: member.error }

  // A registration the student already has on this event (Ethan Lawrence had
  // registered, unpaid, two days before applying). Look under both addresses —
  // the application's and the member record's.
  const emails = [...new Set([member.email, app.email].map((e) => e.trim().toLowerCase()))]
  const found = await findExistingRegistrations(db, emails, input.eventSlug)
  const entries = [...found.values()].flat().filter((e) => e.role === 'participant')
  if (entries.some((e) => e.type !== 'individual')) {
    return {
      ok: false,
      status: 409,
      error: 'This student is on a group registration for this event. A scholarship applies to an individual registration — talk to the group organiser instead.',
    }
  }
  type ExistingRegistration = { id: string; status: string; amount_due_cents: number | null }
  let registration: ExistingRegistration | null = null
  if (entries[0]) {
    const { data } = await db
      .from('registrations')
      .select('id, status, amount_due_cents')
      .eq('id', entries[0].registrationId)
      .maybeSingle()
    registration = (data as ExistingRegistration | null) ?? null
  }

  // One live scholarship per registration — the checkout and the refund both
  // look it up by registration, so a second would be ambiguous.
  if (registration) {
    const { data: other } = await db
      .from('scholarship_applications')
      .select('id, percent_off')
      .eq('registration_id', registration.id)
      .eq('status', 'offered')
      .limit(1)
    const o = (other ?? [])[0] as { id: string; percent_off: number } | undefined
    if (o) {
      return {
        ok: false,
        status: 409,
        error: `This student’s registration already carries a ${o.percent_off}% scholarship (another application). Mark this one not offered instead.`,
      }
    }
  }

  const now = new Date().toISOString()
  const { data: updated, error: updateError } = await db
    .from('scholarship_applications')
    .update({
      status: 'offered',
      percent_off: input.percent,
      event_slug: input.eventSlug,
      event_title: event.title,
      member_id: member.id,
      offer_token: mintOfferToken(),
      reviewed_by: input.reviewer.clerkUserId,
      reviewed_by_name: input.reviewer.name,
      reviewed_at: now,
      offered_at: now,
    })
    .eq('id', app.id)
    .eq('status', 'submitted')
    .select(SCHOLARSHIP_COLUMNS)
    .maybeSingle()
  if (updateError || !updated) {
    console.error('[scholarship] offer update failed:', updateError)
    return { ok: false, status: 409, error: 'This application changed while you were reviewing it — reload and try again' }
  }
  let offer = updated as ScholarshipApplication
  let refund: ScholarshipRefundResult | null = null

  if (registration) {
    await attachOfferToRegistration(db, offer, registration, member.id)
    offer = { ...offer, registration_id: registration.id }
    // A full scholarship on a registration that is only waiting for payment:
    // nothing is left to collect, so confirm it now — unless paid merch add-ons
    // are still pending, which the checkout must collect.
    if (input.percent === 100 && registration.status === 'pending') {
      const addons = await pendingAddonLines(db, registration.id)
      if (addons.length === 0) await confirmRegistration(registration.id, false)
    }
    // The retrospective case: registered and paid before applying. Reimburse
    // the difference between the fee they paid and the scholarship price.
    if (registration.status === 'confirmed') {
      await db.from('scholarship_applications').update({ registration_paid_at_offer: true }).eq('id', offer.id)
      offer = { ...offer, registration_paid_at_offer: true }
      refund = await issueScholarshipRefund(db, stripeClient(), {
        applicationId: offer.id,
        registrationId: registration.id,
        percent: input.percent,
        method: input.refundMethod ?? 'cash',
        actorMemberId: input.reviewer.memberId,
      })
    }
  }

  await logActivity({
    memberId: member.id,
    category: 'event',
    action: 'scholarship_offered',
    summary: `Offered a ${input.percent}% scholarship for ${event.title}`,
    metadata: { scholarshipId: offer.id, percent: input.percent, eventSlug: input.eventSlug, registrationId: offer.registration_id },
    actorType: 'admin',
    actorLabel: input.reviewer.name,
  }, db)

  const emailedTo = input.sendEmails ? await sendScholarshipOfferEmails(db, offer.id) : []
  return { ok: true, application: offer, registrationId: offer.registration_id, emailedTo, refund }
}

/**
 * Sends the offer emails for an offered application, in order: congratulations,
 * registration details, payment (not for 100%, nor once paid). Recipients are
 * the application email and the linked member's email, de-duplicated. Returns
 * who it sent to; stamps offer_emails_sent_at.
 */
export async function sendScholarshipOfferEmails(db: SupabaseClient, applicationId: string): Promise<string[]> {
  const app = await loadApplication(db, applicationId)
  if (!app || app.status !== 'offered' || !app.offer_token || !app.event_slug || app.percent_off == null) return []

  const [event, memberRes, regRes] = await Promise.all([
    getEventBySlug(app.event_slug).catch(() => null),
    app.member_id
      ? db.from('members').select('email').eq('id', app.member_id).maybeSingle()
      : Promise.resolve({ data: null }),
    app.registration_id
      ? db.from('registrations').select('status, amount_due_cents').eq('id', app.registration_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const reg = regRes.data as { status: string; amount_due_cents: number | null } | null
  const stage = scholarshipStage({ status: app.status, registration: reg, checkedIn: false })
  // Confirmed already — paid before the offer, or confirmed by a 100% offer.
  // Either way there is nothing to fill in or pay; say what happened instead.
  const settled = stage === 'confirmed' || stage === 'attended'
  let refund: OfferEmailInput['refund'] = null
  let consentOutstanding = false
  if (settled && app.registration_id) {
    if (app.registration_paid_at_offer) {
      const r = await scholarshipRefundFor(db, app.registration_id)
      refund = !r
        ? { method: 'none', cents: 0 }
        : r.type === 'cash' || r.type === 'credit'
          ? { method: r.type, cents: r.refundCents }
          : r.type === 'manual_required'
            ? { method: 'manual', cents: r.refundCents }
            : { method: 'none', cents: 0 }
    }
    consentOutstanding = !(await consentSigned(db, app.registration_id))
  }

  const feeCents = await eventFeeCents((event as { stripePriceId?: string } | null)?.stripePriceId)
  const dueCents =
    reg && reg.status === 'pending' && reg.amount_due_cents != null
      ? reg.amount_due_cents
      : feeCents != null
        ? discountedCents(feeCents, app.percent_off)
        : null
  const eventDate = (event as { date?: string; endDate?: string } | null)?.date
    ? formatDateRange((event as { date: string }).date, (event as { endDate?: string }).endDate)
    : null

  const input: OfferEmailInput = {
    firstName: app.first_name.trim(),
    eventTitle: app.event_title ?? (event as { title?: string } | null)?.title ?? 'your Stellr event',
    eventDate,
    percent: app.percent_off,
    feeCents,
    dueCents,
    detailsComplete: stage !== 'awaiting_details',
    registerUrl: scholarshipRegisterUrl(app.event_slug, app.offer_token),
    offerUrl: scholarshipOfferUrl(app.offer_token),
    alreadyPaid: settled,
    refund,
    consentOutstanding,
  }

  const memberEmail = (memberRes.data as { email?: string } | null)?.email
  const to = [...new Set([app.email, memberEmail].filter((e): e is string => !!e).map((e) => e.trim().toLowerCase()))]

  const messages = [scholarshipOfferEmail(input)]
  if (stage === 'awaiting_details' || stage === 'awaiting_payment') {
    messages.push(scholarshipDetailsEmail(input))
    if (app.percent_off < 100) messages.push(scholarshipPaymentEmail(input))
  } else if (settled && consentOutstanding) {
    // Registered and paid: the only thing left is the consent form.
    messages.push(scholarshipDetailsEmail(input))
  }
  for (const m of messages) {
    for (const addr of to) await sendEmail({ to: addr, ...m })
  }

  await db.from('scholarship_applications').update({ offer_emails_sent_at: new Date().toISOString() }).eq('id', app.id)
  if (app.member_id) {
    await logActivity({
      memberId: app.member_id,
      category: 'event',
      action: 'scholarship_emails_sent',
      summary: `Scholarship emails sent (${messages.length}) to ${to.join(', ')}`,
      metadata: { scholarshipId: app.id, count: messages.length },
      actorType: 'system',
    }, db)
  }
  return to
}

/** A completed consent form (DocuSign, or on file) for anyone on the registration. */
async function consentSigned(db: SupabaseClient, registrationId: string): Promise<boolean> {
  const { data: parts } = await db.from('participants').select('id').eq('registration_id', registrationId)
  const ids = ((parts ?? []) as { id: string }[]).map((p) => p.id)
  if (ids.length === 0) return false
  const { data } = await db
    .from('docusign_envelopes')
    .select('id')
    .in('participant_id', ids)
    .eq('status', 'completed')
    .limit(1)
  return (data ?? []).length > 0
}

export async function markNotOffered(
  db: SupabaseClient,
  applicationId: string,
  reviewer: Reviewer,
): Promise<{ ok: boolean; error?: string }> {
  const now = new Date().toISOString()
  const { data } = await db
    .from('scholarship_applications')
    .update({ status: 'not_offered', reviewed_by: reviewer.clerkUserId, reviewed_by_name: reviewer.name, reviewed_at: now })
    .eq('id', applicationId)
    .eq('status', 'submitted')
    .select('id')
    .maybeSingle()
  return data ? { ok: true } : { ok: false, error: 'Only an application still under review can be marked not offered' }
}
