import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import Stripe from 'stripe'
import { sendEmail, groupConfirmationEmail } from '@/lib/email'
import { ensureIndividualPayments } from '@/lib/individual-payment'
import { finalizeRegistrationMerch } from '@/lib/store/event-merch'
import { createGroupRegistrationSheet, isGoogleSheetsConfigured, type SheetSeedRow } from '@/lib/google-sheets'
import { stripeClient } from '@/lib/stripe'
import { createRegistrationCheckout, ensurePayToken, payPageUrl } from '@/lib/registration-checkout'
import { createAndSendGroupInvoice } from '@/lib/group-invoice'
import { checkInCodeLink } from '@/lib/check-in-codes'
import type { GatedGroup } from './gate'
import { SITE_URL, type GroupBody, type ParticipantPayload } from './parse'
import type { SavedMembers, SavedParticipants, SavedRegistration } from './persist'

type EventGetter = (slug: string) => Promise<{ stripePriceId?: string } | null>
/** Passed to the email as sent ('none' on a free event). */
type ConfirmationEmail = Parameters<typeof groupConfirmationEmail>[0]

/**
 * ── Google Sheet (every group registration gets a linked sheet) ────────────
 * Created up front so the teacher/student-manager can always open it from the
 * member portal, regardless of the details method they chose on the form.
 */
async function createGroupSheet(group: GatedGroup, body: GroupBody, regId: string): Promise<string | null> {
  const { db, teacher, eventTitle, linkedSlotNames } = group
  const { registrant_role, adult_count, student_count, details_method, additional_adults, students } = body

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
      //
      // A linked slot's sheet row carries the submitted name. With no email, sheet
      // sync skips the row.
      const seedFromPayload = (p: ParticipantPayload, type: SheetSeedRow['type']): SheetSeedRow => {
        const linkedName = linkedSlotNames.get(p)
        if (linkedName) {
          return {
            type, ...linkedName,
            email: '', phone: '', date_of_birth: '', gender: '', t_shirt_size: '', grade: '',
            dietary_requirements: [], health_conditions: '',
            ec_first_name: '', ec_last_name: '', ec_email: '', ec_phone: '', ec_relationship: '',
            school_email: '',
          }
        }
        return {
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
          school_email: p.school_email ?? '',
        }
      }
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
        eventTitle,
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
  return spreadsheetUrl
}

/**
 * ── Group join token ──────────────────────────────────────────────────────
 * EVERY group gets a forwardable completion link, so the confirmation email can
 * always carry both ways of providing member details (sheet + link) whichever
 * method was chosen on the form. Handing one out for an already-complete roster
 * is safe: the join page enforces the declared seat cap and shows "this group is
 * full" instead of admitting an extra person.
 */
async function createGroupJoinLink(group: GatedGroup, body: GroupBody, regId: string): Promise<string | null> {
  const { event_slug } = body
  const token = randomBytes(32).toString('hex')
  const { error: tokenError } = await group.db.from('group_join_tokens').insert({
    token,
    registration_id: regId,
    event_slug,
    event_title: group.eventTitle,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  })
  if (tokenError) {
    console.error('Group join token insert error (non-fatal):', tokenError)
    return null
  }
  return `${SITE_URL}/register/${event_slug}/join/${token}`
}

/** What the invoice, the checkout and the individual links each need of the request. */
interface PaymentContext {
  regId: string
  payToken: string | null
  promptSpreadsheetUrl: string | null
  incompleteAddNow: boolean
  joinUrl: string | null
  remainingCount: number
}

/**
 * Collect the money by the chosen route. The checkout URL when there is one, or a
 * Response when a checkout could not be started, which ends the request.
 */
async function collectPayment(
  group: GatedGroup,
  body: GroupBody,
  members: SavedMembers,
  { participantsWithId }: SavedParticipants,
  ctx: PaymentContext,
  getEvent: EventGetter,
): Promise<string | null | Response> {
  const { db, teacher, eventTitle } = group
  const { amountDueCents, feeUnitAmount } = group.price
  const { event_slug, payment_method, total_participants, member_pays_individually } = body
  const { regId, payToken, promptSpreadsheetUrl, incompleteAddNow, joinUrl, remainingCount } = ctx

  // ── Look up Stripe Price ID ───────────────────────────────────────────────
  // A second read, kept from the original route. S5 A7: a price added after the
  // gate's read would get past a refusal of priced tenant events, so A7 uses
  // group.event here or applies the refusal again to this read.
  const event = await getEvent(event_slug)
  const stripePriceId = event?.stripePriceId
  const stripe = stripeClient()

  let checkoutUrl: string | null = null

  if (payment_method === 'invoice' && stripePriceId && stripe) {
    try {
      const priceObj = await stripe.prices.retrieve(stripePriceId)
      // Single source of truth for the amount: reuse amountDueCents, resolved once
      // in the gate from this same price × seats. Re-deriving it here (priceObj.unit_amount
      // × total_participants) was a second, independent calc that could — and did —
      // diverge from the stored amount and silently collapse to $0.00 (unit_amount
      // defaulting to 0), finalising and emailing a $0 invoice for a paid event.
      let invoiceAmountCents = amountDueCents
      let perSeatCents = feeUnitAmount ?? 0
      // Transient recovery: if the early price lookup failed (feeUnitAmount null →
      // amountDueCents collapsed to 0) but THIS retrieve succeeded, re-derive the
      // amount from the price we just fetched and persist it, so the stored
      // amount_due_cents always matches what is actually billed. Without this, a
      // blip on the first lookup silently dropped a correctly-priced invoice while
      // the UI told the organiser one was sent.
      if (feeUnitAmount === null) {
        perSeatCents = priceObj.unit_amount ?? 0
        invoiceAmountCents = perSeatCents * (total_participants ?? 0)
        if (invoiceAmountCents > 0) {
          await db.from('registrations').update({ amount_due_cents: invoiceAmountCents }).eq('id', regId)
        }
      }
      // Guard: never finalise/send a non-positive invoice for a paid event. The
      // positively-resolved-$0 case is already rejected up front (before any
      // records exist); this backstop only remains reachable when the early lookup
      // failed AND the price genuinely resolves to 0 — leave the registration
      // unpaid for admin follow-up rather than sending a bogus $0.00 invoice.
      if (invoiceAmountCents <= 0) {
        console.error('[register/group] invoice NOT sent — non-positive amount', {
          eventSlug: event_slug, stripePriceId, perSeatCents,
          total_participants, invoiceAmountCents,
        })
      } else {
        await createAndSendGroupInvoice(db, stripe, {
          registrationId: regId,
          eventSlug: event_slug,
          eventTitle,
          teacher: { email: teacher.email, firstName: teacher.first_name, lastName: teacher.last_name },
          registrantMemberId: members.registrantMemberId ?? null,
          amountCents: invoiceAmountCents,
          perSeatCents,
          currency: priceObj.currency,
          totalParticipants: total_participants,
        })
      }
    } catch (invoiceErr) {
      console.error('Stripe invoice error (non-fatal):', invoiceErr)
    }
  } else if (payment_method === 'card' && stripePriceId && stripe) {
    // The sub-minimum case is already rejected up front (before any records are
    // created). This try/catch is defence-in-depth for any *other* Stripe error
    // (e.g. a price in the wrong mode) so the registrant sees the real reason
    // instead of a generic "Internal server error". Records already exist at this
    // point, so we surface the failure and let the confirmation/billing flow
    // recover rather than orphaning silently.
    try {
      const session = await createRegistrationCheckout(db, stripe, regId, {
        event: group.event,
        customerEmail: teacher.email,
        successUrl: (() => {
          const u = new URL(`${SITE_URL}/register/${event_slug}/confirmation`)
          u.searchParams.set('id', regId); u.searchParams.set('type', 'group'); u.searchParams.set('payment', 'success')
          if (promptSpreadsheetUrl) u.searchParams.set('spreadsheet', promptSpreadsheetUrl)
          if (incompleteAddNow && joinUrl) u.searchParams.set('join', joinUrl)
          if (remainingCount > 0) u.searchParams.set('remaining', String(remainingCount))
          return u.toString()
        })(),
        // Abandoned checkout lands on the pay page, not a blank form.
        cancelUrl: payPageUrl(event_slug, payToken ?? (await ensurePayToken(db, regId)), { cancelled: true }),
      })
      checkoutUrl = session.url
    } catch (checkoutErr) {
      console.error('[register/group] card checkout session create failed:', checkoutErr)
      const stripeMessage = checkoutErr instanceof Stripe.errors.StripeError ? checkoutErr.message : null
      return NextResponse.json(
        {
          error: stripeMessage
            ? `Payment could not be started: ${stripeMessage}`
            : 'Payment could not be started. Your registration was saved — please contact Stellr to complete payment.',
          registrationId: regId,
        },
        { status: 502 },
      )
    }
  } else if (member_pays_individually) {
    // Everyone entered now, including the registrant — their own seat is billed
    // too when members pay individually. Anyone still to come (sheet rows, join
    // link, organiser manual add) is handled by those paths, which call the same
    // helper. This branch used to be gated on `details_method === 'add_now' &&
    // stripePriceId && stripe`, so picking the spreadsheet method — or a free
    // event — silently billed and emailed nobody at all.
    await ensureIndividualPayments(
      db,
      regId,
      participantsWithId
        .map(({ row, participantId }) =>
          participantId
            ? {
                participantId,
                email:     row.email,
                firstName: row.first_name,
                lastName:  row.last_name,
              }
            : null
        )
        .filter((p): p is NonNullable<typeof p> => p !== null),
    )
  }
  return checkoutUrl
}

/**
 * POST /api/register/group, the last step: the sheet and join link, then the money,
 * merch and the confirmation email, then the answer. The rows exist by now, so
 * failures here are non-fatal, except a card checkout that could not be started.
 */
export async function respondToGroupRegistration(
  group: GatedGroup,
  body: GroupBody,
  { regId, payToken }: SavedRegistration,
  members: SavedMembers,
  participants: SavedParticipants,
  signInToken: string | null,
  getEvent: EventGetter,
): Promise<Response> {
  const { db, teacher, eventTitle, isCampaign } = group
  const { nothingToCollect } = group.price
  const {
    event_slug, registrant_role, adult_count, student_count, total_participants,
    details_method, payment_method, additional_adults, students,
  } = body

  const spreadsheetUrl = await createGroupSheet(group, body, regId)

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

  const joinUrl = await createGroupJoinLink(group, body, regId)

  // The sheet is created for every group, but it's only an *action item* — and so
  // surfaced on the confirmation PAGE / Stripe return — when members still need
  // entering. The email always shows both links regardless (see below).
  const promptSpreadsheetUrl = details_method !== 'add_now' || incompleteAddNow ? spreadsheetUrl : null

  const collected = await collectPayment(group, body, members, participants, {
    regId, payToken, promptSpreadsheetUrl, incompleteAddNow, joinUrl, remainingCount,
  }, getEvent)
  if (collected instanceof Response) return collected
  const checkoutUrl = collected

  // Free events are confirmed at insert without ever passing through the Stripe
  // webhook, which is the only other place merch is finalised — so included
  // shirts were never allocated and add-ons never left 'pending' for them.
  // Do it here so 'confirmed' means the same thing on both paths. Runs after
  // the participant insert because allocation is per participant. Idempotent
  // and non-fatal by contract.
  if (nothingToCollect && !isCampaign) {
    await finalizeRegistrationMerch(db, regId)
  }

  // ── CC list for confirmation emails ───────────────────────────────────────
  const ccEmails: string[] = []
  if (body.teacher_poc?.email) ccEmails.push(body.teacher_poc.email)

  // ── Confirmation email (includes both spreadsheet + join link when available) ─
  try {
    const emailContent = groupConfirmationEmail({
      teacherFirstName: teacher.first_name,
      teacherLastName: teacher.last_name,
      schoolName: teacher.school_name,
      eventTitle,
      participantCount: total_participants,
      registrationId: regId,
      paymentMethod: payment_method as ConfirmationEmail['paymentMethod'],
      detailsMethod: details_method as ConfirmationEmail['detailsMethod'],
      // Both links go in every group email — including a complete add_now, where
      // they're framed as "keep these for later" rather than an action item.
      spreadsheetUrl: spreadsheetUrl ?? undefined,
      joinUrl: joinUrl ?? undefined,
      remainingCount,
      // The way back if the card redirect is never completed.
      payUrl: payment_method === 'card' && checkoutUrl && payToken ? payPageUrl(event_slug, payToken) : undefined,
      checkInCodeUrl: checkInCodeLink(event_slug, 'g', regId) ?? undefined,
    })
    await sendEmail({ to: teacher.email, cc: ccEmails, ...emailContent })
    // The confirmation email now carries the pay link, so the separate
    // pay-link email isn't sent here — just stamp the send for the cooldown.
    if (payment_method === 'card' && checkoutUrl && payToken) {
      await db.from('registrations').update({ pay_link_sent_at: new Date().toISOString() }).eq('id', regId)
    }
  } catch (emailErr) {
    console.error('Confirmation email failed (non-fatal):', emailErr)
  }

  return NextResponse.json({ registrationId: regId, checkoutUrl, spreadsheetUrl: promptSpreadsheetUrl, joinUrl, signInToken }, { status: 201 })
}
