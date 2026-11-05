import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkRegistrationAge } from '@/lib/registration-eligibility'
import { registrationIsOpen, type RegistrationGateSource } from '@/lib/registration'
import { getCurrentMember } from '@/lib/community'
import { sessionChildAwaitingConsentBlock } from '@/lib/pending-consent'
import { assertNotImpersonating } from '@/lib/impersonation'
import { stripeClient } from '@/lib/stripe'
import { findOfferByToken, type ScholarshipApplication } from '@/lib/scholarships'
import { ageRefused, refuse, temporarilyUnavailable, type Refusable } from '../refusal'
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
}

/** What the gate established, for the writes that follow. */
export interface GatedRegistration {
  db: SupabaseClient
  event: IndividualEvent
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
  const scholarship = body.scholarship_token
    ? await findOfferByToken(deps.serviceClient(), body.scholarship_token)
    : null
  if (body.scholarship_token && (!scholarship || scholarship.event_slug !== event_slug)) {
    return refuse(NextResponse.json(
      { error: 'This scholarship link is no longer valid. Reply to your scholarship email and we’ll sort it out.' },
      { status: 400 },
    ))
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
  let event: IndividualEvent | null
  try {
    event = await deps.getEvent(event_slug)
  } catch (e) {
    console.error('[register/individual] event lookup failed:', e)
    return refuse(temporarilyUnavailable())
  }
  if (!event) {
    return refuse(NextResponse.json({ error: 'Event not found' }, { status: 404 }))
  }
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
  const ageCheck = checkRegistrationAge(body.date_of_birth, { eventDate: event.date ?? null })
  if (!ageCheck.ok) return refuse(ageRefused(ageCheck))

  const db = deps.serviceClient()

  const duplicateAnswer = await answerDuplicate(db, {
    email,
    eventSlug: event_slug,
    event,
    sessionEmail: sessionMember?.email,
    scholarship,
  })
  if (duplicateAnswer) return refuse(duplicateAnswer)

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
