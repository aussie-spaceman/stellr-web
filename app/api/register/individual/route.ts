import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import { ageFromDob, maskEmail } from '@/lib/utils'
import { registrationIsOpen } from '@/lib/registration'
import type { RegistrationRow } from '@/lib/database.types'
import { dispatchAgreement } from '@/lib/docusign-agreements'
import { normalizeGender, normalizeAgeBracket, normalizeEventRole, normalizeGrade, normalizeTshirt, normalizeEmail } from '@/lib/member-enums'
import { resolveAndLinkSchool } from '@/lib/school-link'
import { recordEventParticipation } from '@/lib/event-participation-sync'
import { syncMemberOptionSelections } from '@/lib/member-profile-options'
import { getCurrentMember } from '@/lib/community'
import { autoGrantBaseMembership } from '@/lib/auto-membership-grant'
import { ensureClerkUserAndSignInToken } from '@/lib/clerk-provisioning'
import { prepareRegistrationAddons, addRegistrationAddons } from '@/lib/store/event-merch'
import { assertNotImpersonating } from '@/lib/impersonation'
import { stripeClient } from '@/lib/stripe'
import { findExistingRegistrations, resolveDuplicate } from '@/lib/registration-duplicates'
import {
  createRegistrationCheckout,
  RegistrationCheckoutError,
  ensurePayToken,
  mintPayToken,
  payPageUrl,
} from '@/lib/registration-checkout'
import { sendPayLinkEmail } from '@/lib/registration-pay-link'

const APP_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'
// Where a registrant lands afterwards — the member portal, with a flag the
// /community page reads to pop the "registration submitted" modal.
const POST_REGISTER_URL = `${APP_URL}/community?registered=1&type=individual`

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      event_slug, event_title,
      first_name, last_name, nickname, phone, date_of_birth,
      grade, gender, ethnicity, t_shirt_size, school_name,
      age_bracket, event_role,
      dietary_requirements, health_conditions,
      emergency_contact_first_name, emergency_contact_last_name,
      emergency_contact_email, emergency_contact_phone,
      emergency_contact_relationship,
      school_address_state,
    } = body

    // Option A — a signed-in member can only register under their own address.
    // Trust the session email over whatever the client submitted; this prevents
    // duplicate member rows and forged-identity registrations. Falls back to the
    // submitted email when there's no resolvable session (e.g. on www).
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

    const sessionMember = await getCurrentMember().catch(() => null)
    const email: string = normalizeEmail(sessionMember?.email ?? body.email)

    if (!event_slug || !email || !first_name || !last_name) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Registration window gate — reject before creating any records / sending
    // DocuSign if the event's registration isn't currently open (FR-EVT).
    const eventForGate = await getEventBySlug(event_slug).catch(() => null)
    if (eventForGate && !registrationIsOpen(eventForGate)) {
      return NextResponse.json({ error: 'Registration is not open for this event.' }, { status: 403 })
    }

    // School is mandatory — accept either an existing school id or a non-empty
    // new-school name. Server-side backstop so the requirement holds even if the
    // client validation is bypassed.
    const hasSchool = !!body.school_id || (typeof school_name === 'string' && school_name.trim().length > 0)
    if (!hasSchool) {
      return NextResponse.json({ error: 'Please select your school.' }, { status: 400 })
    }

    const db = supabaseServer()

    // Duplicate check: same email on this event. An unpaid 'pending' row is
    // not a duplicate to refuse — it's the same person coming back (17 Sept
    // 2026: a parent closed the Stripe tab and was locked out by this check).
    // The registrant themselves (session email matches) goes straight to a
    // fresh checkout; anyone else gets the pay link by email, never in the
    // response, so knowing an address alone reveals nothing.
    const existing = await findExistingRegistrations(db, [email], event_slug)
    const dup = resolveDuplicate(existing.get(email), {
      sessionMatches: !!sessionMember?.email && normalizeEmail(sessionMember.email) === email,
    })
    if (dup.kind !== 'none') {
      const regId = dup.registration.registrationId
      // An unfinished GROUP registration isn't resumed from the individual form
      // — the organiser has the pay link in their confirmation email and under
      // Account → Teams.
      if ((dup.kind === 'resume' || dup.kind === 'email_link') && dup.registration.type !== 'individual') {
        return NextResponse.json(
          { code: 'already_registered', error: `${email} already has a group registration for this event. Complete its payment from the link in your confirmation email, or under Account → Teams.` },
          { status: 409 },
        )
      }
      if (dup.kind === 'resume') {
        const stripe = stripeClient()
        if (stripe) {
          try {
            const { url } = await createRegistrationCheckout(db, stripe, regId, {
              event: eventForGate as { stripePriceId?: string } | null,
              customerEmail: email,
              successUrl: `${POST_REGISTER_URL}&payment=success`,
              cancelUrl: payPageUrl(event_slug, await ensurePayToken(db, regId), { cancelled: true }),
            })
            return NextResponse.json({ resume: true, registrationId: regId, checkoutUrl: url }, { status: 200 })
          } catch (e) {
            // Nothing to collect (free event left pending) or a Stripe hiccup —
            // fall through to the plain "already registered" answer.
            if (!(e instanceof RegistrationCheckoutError)) console.error('[register/individual] resume checkout failed:', e)
          }
        }
      }
      if (dup.kind === 'email_link') {
        const sent = await sendPayLinkEmail(db, regId).catch((e) => {
          console.error('[register/individual] pay-link resend failed (non-fatal):', e)
          return { sent: false, reason: undefined, recipients: [] as string[] }
        })
        const where = sent.recipients.length > 0 ? sent.recipients.map(maskEmail) : [maskEmail(email)]
        // Inside the resend cooldown nothing went out just now — say so, rather
        // than promising an email that isn't coming.
        const verb = sent.reason === 'cooldown' ? 'We recently emailed' : 'We’ve emailed'
        return NextResponse.json(
          {
            code: 'unfinished_registration',
            error: `This email already has an unfinished registration for this event. ${verb} a link to complete payment to ${where.join(' and ')} — check spam if it hasn’t arrived in a few minutes.`,
          },
          { status: 409 },
        )
      }
      if (dup.kind === 'in_group') {
        return NextResponse.json(
          { code: 'in_group', error: `${email} is already part of a group registration for this event. Ask your teacher or group organiser if anything needs changing.` },
          { status: 409 },
        )
      }
      return NextResponse.json(
        { code: 'already_registered', error: `${email} is already registered for this event. If that’s you, sign in to see it under Account → Events.` },
        { status: 409 },
      )
    }

    // Campaigns are entered as a GROUP, never by an individual student — the
    // campaign page only ever links to the group form. This route is still
    // reachable by URL, though, and an individual campaign registration would be
    // written as type 'individual' while the member's campaign context and
    // workspace both filter on type 'campaign' — so it would be accepted and
    // then be invisible to the person who made it. Reject it before any writes.
    if ((eventForGate as { activityType?: string } | null)?.activityType === 'campaign') {
      return NextResponse.json(
        {
          error:
            'Campaigns are entered as a group, not by individual students. Please use the group registration form.',
        },
        { status: 400 },
      )
    }

    // Amount owed: the per-seat event fee (one seat), or 0 when the event is
    // free — either no Stripe price at all, or an explicit $0 price object.
    // Drives the payment access gate, and the line item further down.
    let amountDueCents = 0
    const feePriceId = (eventForGate as { stripePriceId?: string } | null)?.stripePriceId
    const feeStripe = stripeClient()
    if (feePriceId && feeStripe) {
      try {
        const pr = await feeStripe.prices.retrieve(feePriceId)
        amountDueCents = pr.unit_amount ?? 0
      } catch (e) {
        // The event has a fee price configured but Stripe can't resolve it
        // (deleted price, or a test-mode id pasted into a live-mode event config).
        // Don't swallow this: continuing would create orphaned registration /
        // member / DocuSign records and then still throw when Checkout rejects
        // the same invalid price — surfacing an opaque "Internal server error".
        // Fail fast, before any writes, with an actionable message.
        console.error('[register/individual] invalid stripePriceId on event', event_slug, '—', feePriceId, e)
        return NextResponse.json(
          { error: 'This event’s registration fee is misconfigured — please contact support before registering.' },
          { status: 503 },
        )
      }
    }

    // Create registration record
    const payToken = mintPayToken()
    const { data: registration, error: regError } = await db
      .from('registrations')
      .insert({
        event_slug,
        event_title,
        type: 'individual',
        status: 'pending',
        amount_due_cents: amountDueCents,
        invoice_requested: false,
        // Pay-later capability — see lib/registration-checkout.ts.
        pay_token: payToken,
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

    // Upsert member record — creates one if this email hasn't registered before
    const ageNow = ageFromDob(date_of_birth)
    const resolvedBracket = ageNow < 18 ? 'high_school' : normalizeAgeBracket(age_bracket)
    const resolvedRole = ageNow < 18 ? 'participant' : normalizeEventRole(event_role)

    const { data: memberRow, error: memberUpsertError } = await db
      .from('members')
      .upsert({
        email,
        first_name,
        last_name,
        nickname: nickname || null,
        phone,
        date_of_birth,
        gender: normalizeGender(gender),
        grade: normalizeGrade(grade),
        tshirt_size: normalizeTshirt(t_shirt_size),
        age_bracket: resolvedBracket,
        event_role: resolvedRole,
        is_active: true,
        // Persist the profile so the member doesn't re-enter it next time (028).
        // Emergency contact goes to the members table's canonical ec_* columns —
        // the same ones /account, admin, and group-join read (029). Ethnicity and
        // dietary go to the member_ethnicities/member_allergies join tables below
        // for the same reason (030).
        health_conditions: health_conditions || null,
        ec_first_name: emergency_contact_first_name || null,
        ec_last_name: emergency_contact_last_name || null,
        ec_email: emergency_contact_email || null,
        ec_phone: emergency_contact_phone || null,
        ec_relationship: emergency_contact_relationship || null,
      }, { onConflict: 'email', ignoreDuplicates: false })
      .select('id')
      .maybeSingle()
    if (memberUpsertError) {
      console.error('Member upsert error (non-fatal — participant still created):', memberUpsertError)
    }

    const memberId = memberRow?.id ?? null

    // Resolve the school to a schools row and link the member to it, so the
    // school surfaces in /admin/schools and on the member page — not just as
    // free text on the participant row. When the registrant picked an existing
    // school, school_id is authoritative (we link to it, never create a dupe);
    // otherwise we resolve-or-create by normalized name. resolvedSchool.state is
    // the canonical state used to fill the DocuSign "State of Residence" tab.
    const resolvedSchool = await resolveAndLinkSchool(db, memberId ? [memberId] : [], {
      id: body.school_id ?? null,
      name: school_name,
      address_street: body.school_address_street ?? null,
      address_city: body.school_address_city ?? null,
      address_state: school_address_state ?? null,
      address_zip: body.school_address_zip ?? null,
    })
    if (memberId) {
      await syncMemberOptionSelections(db, [
        { memberId, ethnicity, dietary: dietary_requirements },
      ])
    }

    // Create participant record
    const { data: partRow, error: partError } = await db.from('participants').insert({
      registration_id: regId,
      member_id: memberId,
      first_name, last_name, nickname: nickname || null,
      email, phone, date_of_birth, grade, gender,
      ethnicity: ethnicity ?? [],
      t_shirt_size, school_name, age_bracket,
      event_role: resolvedRole,
      dietary_requirements: dietary_requirements ?? [],
      health_conditions: health_conditions || null,
      emergency_contact_first_name, emergency_contact_last_name,
      emergency_contact_email, emergency_contact_phone,
      emergency_contact_relationship: emergency_contact_relationship || null,
    }).select('id').single()

    if (partError || !partRow) {
      console.error('Participant insert error:', partError)
      await db.from('registrations').delete().eq('id', regId)
      return NextResponse.json({ error: 'Failed to save participant details' }, { status: 500 })
    }

    // Record this registration in event_participations so it appears in the
    // "Event Activity" lists on the member portal and admin member page.
    await recordEventParticipation(db, { memberId, eventSlug: event_slug, eventTitle: event_title, registrationId: regId })

    // Turn a non-member registrant into a member: grant the free base tier
    // (Explorer / Educator / Alumni) if they still hold no membership after the
    // grant rules ran above. Idempotent + non-fatal — existing members untouched.
    await autoGrantBaseMembership(db, memberId)

    // Trigger the appropriate DocuSign agreement (minor consent, or self-signed
    // adult/mentor participation agreement) for this participant.
    await dispatchAgreement(db, {
      participantId:     partRow.id,
      memberId,
      eventSlug:         event_slug,
      eventTitle:        event_title,
      firstName:         first_name,
      lastName:          last_name,
      email,
      phone,
      dateOfBirth:       date_of_birth,
      eventRole:         event_role,
      schoolName:        school_name,
      // Prefer the canonical state on the linked school row — the form only
      // sends an address (and thus a state) for brand-new schools, so for an
      // existing-school selection school_address_state is empty.
      schoolState:       resolvedSchool?.state ?? school_address_state ?? null,
      guardianFirstName: emergency_contact_first_name,
      guardianLastName:  emergency_contact_last_name,
      guardianEmail:     emergency_contact_email,
      guardianPhone:     emergency_contact_phone,
      relationship:      emergency_contact_relationship,
    })

    // Provision a Clerk account + sign-in token so a brand-new registrant is
    // silently signed in and lands in the member portal (/community) afterwards.
    // Already-signed-in members have a session + clerk_user_id already. Non-fatal
    // — a Clerk hiccup must never fail the registration.
    let signInToken: string | null = null
    if (!sessionMember) {
      try {
        const provisioned = await ensureClerkUserAndSignInToken(email, first_name, last_name)
        signInToken = provisioned.signInToken
        if (memberId) {
          await db.from('members').update({ clerk_user_id: provisioned.clerkUserId }).eq('id', memberId)
        }
      } catch (clerkErr) {
        console.error('Clerk provisioning (non-fatal):', clerkErr)
      }
    }

    // Price any merch add-ons selected — validated + persisted as pending items
    // on the registration's event-merch order until payment clears.
    const event = await getEventBySlug(event_slug)
    const stripe = stripeClient()
    const addonLines = await prepareRegistrationAddons(db, event_slug, body.merch_addons ?? [])
    if (addonLines.length > 0) {
      await addRegistrationAddons(db, regId, addonLines, memberId)
    }

    if (!stripe) {
      // No payment due — sign in (client) and go straight to /community.
      return NextResponse.json({ registrationId: regId, checkoutUrl: null, signInToken }, { status: 201 })
    }

    // Stripe Checkout (event fee + any add-ons), built from the registration
    // row by the same helper the pay page uses — so the checkout can be
    // rebuilt later if this one is abandoned. Cancel lands on the pay page,
    // not a blank form.
    let checkoutUrl: string | null = null
    try {
      const session = await createRegistrationCheckout(db, stripe, regId, {
        event: event as { stripePriceId?: string } | null,
        customerEmail: email,
        // After payment, land in the member portal with the registration modal —
        // the client signs the registrant in before redirecting to Stripe, so the
        // session cookie is already set when they return here.
        successUrl: `${POST_REGISTER_URL}&payment=success`,
        cancelUrl: payPageUrl(event_slug, payToken, { cancelled: true }),
      })
      checkoutUrl = session.url
    } catch (e) {
      if (e instanceof RegistrationCheckoutError && e.code === 'nothing_to_pay') {
        // Free event (and no add-ons) — nothing to collect.
        return NextResponse.json({ registrationId: regId, checkoutUrl: null, signInToken }, { status: 201 })
      }
      throw e
    }

    // The way back if the redirect below is never completed: the registrant
    // (and their emergency contact — for a minor, the parent who is usually the
    // one paying) get the durable pay link now. Non-fatal.
    try {
      await sendPayLinkEmail(db, regId, { force: true })
    } catch (emailErr) {
      console.error('[register/individual] pay-link email failed (non-fatal):', emailErr)
    }

    return NextResponse.json({ registrationId: regId, checkoutUrl, signInToken }, { status: 201 })
  } catch (e) {
    console.error('Individual registration error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
