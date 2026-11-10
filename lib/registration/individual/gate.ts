import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeEmail } from '@/lib/member-enums'
import { checkRegistrationAge } from '@/lib/registration-eligibility'
import { registrationIsOpen, type RegistrationGateSource } from '@/lib/registration'
import { getCurrentMember } from '@/lib/community'
import { sessionChildAwaitingConsentBlock } from '@/lib/pending-consent'
import { assertNotImpersonating } from '@/lib/impersonation'
import { stripeClient } from '@/lib/stripe'
import { findOfferByToken, type ScholarshipApplication } from '@/lib/scholarships'
import { findMemberOnFile, SIGN_IN_REQUIRED } from '../member-on-file'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { assertRegistrable, stellrContext } from '../eligibility'
import {
  eventOwnerOrRefusal,
  readRegistrationEvent,
  tenantPaymentsUnavailable,
  type RegistrationEventContext,
} from '../event-context'
import { eligibilityRefused, refuse, temporarilyUnavailable, type Refusable } from '../refusal'
import { answerDuplicate } from './duplicates'
import { hasSchool, registrantEmails, type IndividualBody } from './parse'

// POST /api/register/individual, everything that decides whether this registration
// may be written. Nothing here writes, except a duplicate's own answer (attaching
// an offer to the earlier registration, its checkout or its pay link).

/** The event fields this route reads. */
export type IndividualEvent = RegistrationGateSource & {
  title?: string
  date?: string | null
  activityType?: string
  stripePriceId?: string
}

/**
 * What the route hands in. It stays the one file that takes the service-role
 * client and the Sanity getter, so test/baselines/** still list it for both.
 */
export interface GateDeps {
  serviceClient: () => SupabaseClient
  getEvent: (slug: string) => Promise<IndividualEvent | null>
  /** requestTenant().tenantId: Stellr unless the proxy marked this request as a tenant host's. */
  requestTenantId: string
}

/** What the gate established, for the writes that follow. */
export interface GatedRegistration {
  db: SupabaseClient
  event: IndividualEvent
  /** The event's owner and rules (lib/registration/event-context). */
  context: RegistrationEventContext
  eventTitle: string
  email: string
  schoolEmail: string | null
  /**
   * Signed in as a member, not just a caller naming an address. Only the gate may
   * set this: it also means `email` came from the session, which is what allows
   * persist to rewrite that member's row.
   */
  hasSession: boolean
  scholarship: ScholarshipApplication | null
  dateOfBirth: string
  isMinor: boolean
  amountDueCents: number
}

export type GateResult = Refusable<{ registration: GatedRegistration }>

export async function gateIndividualRegistration(body: IndividualBody, deps: GateDeps): Promise<GateResult> {
  const { event_slug } = body

  // Option A — a signed-in member can only register under their own address.
  // The session email wins over whatever the client submitted, which keeps one
  // member row per person. Falls back to the submitted email when there's no
  // resolvable session (e.g. on www).
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return refuse(impersonationBlock)

  // Decision 24, COPPA: a signed-in child whose parent has not consented
  // registers for nothing until the parent signs (lib/pending-consent).
  // Asked before getCurrentMember, which resolves no member for them and
  // would otherwise let the submitted email stand in for the session's.
  const childBlock = await sessionChildAwaitingConsentBlock(deps.serviceClient())
  if (childBlock) return refuse(childBlock)

  const sessionMember = await getCurrentMember().catch(() => null)
  const { email, schoolEmail } = registrantEmails(sessionMember?.email, body)

  if (!event_slug || !email || !body.first_name || !body.last_name) {
    return refuse(NextResponse.json({ error: 'Missing required fields' }, { status: 400 }))
  }

  // Arrived from a scholarship offer email (?scholarship=<token>). The offer
  // must be live and for this event; a stale link is refused rather than
  // silently registering the student at full price.
  //
  // S5 A7: offers are Stellr's. On a tenant's host none is looked up, and every
  // offer link gets the answer an unknown one does.
  const offerInvalid = () => NextResponse.json(
    { error: 'This scholarship link is no longer valid. Reply to your scholarship email and we’ll sort it out.' },
    { status: 400 },
  )
  if (body.scholarship_token && deps.requestTenantId !== STELLR_TENANT_ID) return refuse(offerInvalid())
  const scholarship = body.scholarship_token
    ? await findOfferByToken(deps.serviceClient(), body.scholarship_token)
    : null
  if (body.scholarship_token && (!scholarship || scholarship.event_slug !== event_slug)) {
    return refuse(offerInvalid())
  }

  // Registration window gate — reject before creating any records / sending
  // DocuSign if the event's registration isn't currently open (FR-EVT). An
  // offered scholarship holds the student's place, so the WINDOW isn't gated
  // for it — but the event must still exist.
  //
  // deep review REG-4: fail closed. `getEventBySlug(...).catch(() => null)` +
  // `if (eventForGate && ...)` mapped both a Sanity outage and an unknown slug
  // to null and skipped the gate — so a bogus slug still created a member,
  // participant and DocuSign envelope. Distinguish a transient failure
  // (retryable 503) from a genuinely unknown event (404); never fall through.
  const read = await readRegistrationEvent(event_slug, { getEvent: deps.getEvent, route: 'register/individual' })
  if (read.kind === 'unavailable') return refuse(temporarilyUnavailable())
  if (read.kind === 'not_found') {
    return refuse(NextResponse.json({ error: 'Event not found' }, { status: 404 }))
  }
  const { event } = read
  if (!registrationIsOpen(event) && !scholarship) {
    return refuse(NextResponse.json({ error: 'Registration is not open for this event.' }, { status: 403 }))
  }
  // Server-authoritative title (deep review REG-4): the client's would stamp an
  // invented event name onto the registration, DocuSign envelope and confirmation
  // email. It is used only for an event with no title, which Sanity allows.
  const eventTitle = event.title ?? body.event_title ?? ''

  if (!hasSchool(body)) {
    return refuse(NextResponse.json({ error: 'Please select your school.' }, { status: 400 }))
  }

  // S0 (2 Nov 2026): a real past date of birth, checked here before anything
  // is written. An empty or unreadable one used to fall through to an adult
  // role, bracket and agreement. Age is taken on the event's start date.
  //
  // S5 A7: through assertRegistrable, with the event's rules (lib/registration/
  // event-context). On a tenant's host the event's owner is read first, because its
  // rules decide this check. On Stellr's hosts the event can only go ahead as
  // Stellr's, so Stellr's rules apply, which is exactly the check above, and the
  // owner is read below, before the first read that looks at this person: an event
  // owned by anyone else then gets the unknown event's answer, before anything is
  // read about the person or written.
  // An offer for another tenant's event answers as an unknown offer would.
  const ownerCheck = () =>
    eventOwnerOrRefusal(event, event_slug, {
      db: deps.serviceClient(),
      requestTenantId: deps.requestTenantId,
      route: 'register/individual',
    }, () => (scholarship ? offerInvalid() : NextResponse.json({ error: 'Event not found' }, { status: 404 })))
  let context: RegistrationEventContext | null = null
  if (deps.requestTenantId !== STELLR_TENANT_ID) {
    const owned = await ownerCheck()
    if (!owned.ok) return refuse(owned.response)
    context = owned.context
  }
  const ageCheck = assertRegistrable(body.date_of_birth, context?.eligibility ?? stellrContext(event))
  if (!ageCheck.ok) return refuse(eligibilityRefused(ageCheck))

  // Signed in, the registration is for the account holder, and it writes to their
  // own row. A different date of birth means this is someone else, such as a child
  // on a parent's account, or a date that would change which agreement is sent.
  // Members cannot change their date of birth themselves.
  const storedDateOfBirth = sessionMember?.date_of_birth
    ? checkRegistrationAge(sessionMember.date_of_birth, { eventDate: event.date ?? null })
    : null
  if (storedDateOfBirth?.ok && storedDateOfBirth.dateOfBirth !== ageCheck.dateOfBirth) {
    return refuse(NextResponse.json(
      {
        code: 'date_of_birth_differs',
        error: 'This date of birth doesn’t match the account you’re signed in with. To register someone else, sign out and use a different email address for them. If the date on your account is wrong, please contact us.',
      },
      { status: 409 },
    ))
  }

  if (!context) {
    const owned = await ownerCheck()
    if (!owned.ok) return refuse(owned.response)
    context = owned.context
  }
  // S5 A7: a tenant event takes no money until S9: no fee, no add-ons and no
  // scholarship, so nothing here can reach Stellr's Stripe account for a tenant.
  // Refused before the duplicate check, which can open a Checkout.
  if (!context.isPlatformOwner && (event.stripePriceId || body.scholarship_token || (body.merch_addons ?? []).length > 0)) {
    return refuse(tenantPaymentsUnavailable())
  }

  const db = deps.serviceClient()

  const duplicateAnswer = await answerDuplicate(db, {
    email,
    eventSlug: event_slug,
    event,
    sessionEmail: sessionMember?.email,
    scholarship,
    payments: context.isPlatformOwner,
  })
  if (duplicateAnswer) return refuse(duplicateAnswer)

  // Not on this event, but on file: they sign in before anything is written in
  // that member's name (lib/registration/member-on-file). An offer sent to this
  // address is the exception: making it can create the member row, its link went
  // to this address, and a 13-17-year-old may have no way to make a login yet.
  //
  // S5 A7: not on a tenant's event. It writes no member row and makes no login (see
  // persist), so nothing is written in that member's name, and asking would tell a
  // tenant's form whether an address is on file with Stellr.
  const offerIsForThisAddress = !!scholarship && normalizeEmail(scholarship.email) === email
  if (context.isPlatformOwner && !sessionMember && !offerIsForThisAddress) {
    const onFile = await findMemberOnFile(db, email, schoolEmail)
    if (!onFile.ok) {
      console.error('[register/individual] prior-member lookup failed:', onFile.error)
      return refuse(temporarilyUnavailable())
    }
    if (onFile.onFile) {
      return refuse(NextResponse.json(
        {
          code: SIGN_IN_REQUIRED,
          school_address_only: onFile.schoolAddressOnly,
          error: 'This email is already on file with Stellr. Sign in with the address you first used with us and you’ll come back here to register. If you can’t, or a parent or guardian is helping you, contact us and we’ll help.',
        },
        { status: 409 },
      ))
    }
  }

  // A new registration, with an offer already on another one. An offer covers one
  // registration, and a live token alone must not make a second one free.
  if (scholarship?.registration_id) {
    return refuse(NextResponse.json(
      { error: 'This scholarship has already been used for a registration. Reply to your scholarship email and we’ll sort it out.' },
      { status: 409 },
    ))
  }

  // Campaigns are entered as a GROUP, never by an individual student — the
  // campaign page only ever links to the group form. This route is still
  // reachable by URL, though, and an individual campaign registration would be
  // written as type 'individual' while the member's campaign context and
  // workspace both filter on type 'campaign' — so it would be accepted and
  // then be invisible to the person who made it. Reject it before any writes.
  if (event.activityType === 'campaign') {
    return refuse(NextResponse.json(
      {
        error:
          'Campaigns are entered as a group, not by individual students. Please use the group registration form.',
      },
      { status: 400 },
    ))
  }

  // Amount owed: the per-seat event fee (one seat), or 0 when the event is
  // free — either no Stripe price at all, or an explicit $0 price object.
  // Drives the payment access gate, and the line item further down.
  let amountDueCents = 0
  const feePriceId = event.stripePriceId
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
      return refuse(NextResponse.json(
        { error: 'This event’s registration fee is misconfigured — please contact support before registering.' },
        { status: 503 },
      ))
    }
  }

  return {
    ok: true,
    registration: {
      db,
      event,
      context,
      eventTitle,
      email,
      schoolEmail,
      hasSession: !!sessionMember,
      scholarship,
      dateOfBirth: ageCheck.dateOfBirth,
      isMinor: ageCheck.isMinor,
      amountDueCents,
    },
  }
}
