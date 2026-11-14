import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { registrationIsOpen, type RegistrationGateSource } from '@/lib/registration'
import { getCurrentMember } from '@/lib/community'
import { findMemberOnFile, SIGN_IN_REQUIRED } from '../member-on-file'
import { refuse, temporarilyUnavailable, type Refusable } from '../refusal'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { stellrContext } from '../eligibility'
import {
  eventOwnerOrRefusal,
  readRegistrationEvent,
  tenantPaymentsUnavailable,
  type RegistrationEventContext,
} from '../event-context'
import { answerDuplicates } from './duplicates'
import { accountName } from '../account-name'
import { GROUP_SIZE_MAX, isValidCount, settleAddresses, settleRegistrantName, type GroupBody, type ParticipantPayload, type TeacherPayload } from './parse'
import { priceGroupRegistration, type GroupPrice } from './price'
import { checkDatesOfBirth, refuseBadEmails, resolveLinkedSlots, type LinkedSlotNames } from './roster'

// POST /api/register/group, everything that decides whether this registration may
// be written. Nothing here writes, except a duplicate's own answer (the earlier
// registration's checkout or its pay link).

/** The event fields this route reads. */
export type GroupEvent = RegistrationGateSource & {
  title?: string
  date?: string | null
  activityType?: string
  stripePriceId?: string
}

/**
 * What the route hands in. It stays the one file that takes the service-role
 * client and the Sanity getter, so test/baselines/** still list it for both.
 */
/** S5 A7: the ways to pay a tenant's event refuses until S9, whatever its price. */
const TENANT_REFUSED_PAYMENT_METHODS: ReadonlySet<unknown> = new Set(['card', 'invoice', 'invoice_some', 'teacher_share'])

export interface GateDeps {
  serviceClient: () => SupabaseClient
  getEvent: (slug: string) => Promise<GroupEvent | null>
  /** requestTenant().tenantId: Stellr unless the proxy marked this request as a tenant host's. */
  requestTenantId: string
}

/** What the gate established, for the writes that follow. */
export interface GatedGroup {
  db: SupabaseClient
  event: GroupEvent
  /** The event's owner and rules (lib/registration/event-context). */
  context: RegistrationEventContext
  eventTitle: string
  eventDate: string | null
  isCampaign: boolean
  /** The registrant, with their address settled and their date of birth checked. */
  teacher: TeacherPayload
  /** Signed in as a member: they have a login already and need none provisioned. Always false on a tenant's event. */
  hasSession: boolean
  linkedSlotNames: LinkedSlotNames
  /** Absolute totals: adults + students is everyone, whatever the registrant's role. */
  declaredAdultCount: number
  declaredStudentCount: number
  price: GroupPrice
}

export type GateResult = Refusable<{ group: GatedGroup }>

export async function gateGroupRegistration(body: GroupBody, deps: GateDeps): Promise<GateResult> {
  const {
    event_slug, event_title: clientTitle, registrant_role, teacher, teacher_poc,
    adult_count, student_count, total_participants,
    details_method, additional_adults, students, school_dpa_agreed,
  } = body

  // S5 A7 follow-up (owner decision, 10 Nov 2026): a Stellr member's profile is not
  // used at a tenant's event until S7's consent grant exists. On a tenant's host the
  // event can only go ahead as that tenant's (lib/registration/event-context), so the
  // organiser's Stellr record is not read: the address they type stands, as on the
  // tenant join page, a sign-in is not taken as an identity, and no member is linked
  // (persist). Every answer below is the one an organiser not signed in gets.
  const tenantHost = deps.requestTenantId !== STELLR_TENANT_ID
  const sessionMember = tenantHost ? null : await getCurrentMember().catch(() => null)
  settleAddresses(body, sessionMember?.email)
  // A signed-in organiser's name is their account's, as their address is (owner
  // decision, 13 Nov 2026). Not on a tenant's host, where no member is read.
  settleRegistrantName(body, accountName(sessionMember))

  if (!event_slug || !teacher?.email || !teacher?.first_name || !teacher?.last_name) {
    return refuse(NextResponse.json({ error: 'Missing required fields' }, { status: 400 }))
  }

  // Registration gate — reject before creating any records if registration
  // isn't currently open (FR-EVT). `registrationIsOpen` answers for both kinds,
  // reading the activity type off the CMS document, not the body's `is_campaign`.
  //
  // deep review REG-4: this lookup must FAIL CLOSED. The old
  // `getEventBySlug(...).catch(() => null)` + `if (eventForGate && ...)` mapped
  // both "Sanity unreachable" and "no such slug" to null and then SKIPPED the
  // window gate — so an outage (or an invented slug) sailed past the gate,
  // `collectsNothing(undefined, null)` read the event as free, and the row
  // was written `confirmed` with $0 owing and no payment. Distinguish a
  // transient failure (retryable 503) from a genuinely unknown event (404), and
  // never fall through to free/open.
  const read = await readRegistrationEvent(event_slug, { getEvent: deps.getEvent, route: 'register/group' })
  if (read.kind === 'unavailable') return refuse(temporarilyUnavailable())
  if (read.kind === 'not_found') {
    return refuse(NextResponse.json({ error: 'Event not found' }, { status: 404 }))
  }
  const { event } = read
  if (!registrationIsOpen(event)) {
    return refuse(NextResponse.json({ error: 'Registration is not open for this event.' }, { status: 403 }))
  }
  // deep review REG-3: the activity type is authoritative from the CMS, never
  // the client. It alone decides `type: 'campaign'` + `status: 'confirmed'`.
  const isCampaign = event.activityType === 'campaign'
  // deep review REG-4: the title is the server's, not the client's — a bogus
  // request can't stamp an invented event name onto a real registration/email.
  const eventTitle = event.title ?? clientTitle ?? ''
  // A school is mandatory — it drives school linking, the DocuSign SchoolName
  // tab, and FERPA scoping. The form gates on this too, but enforce it here so
  // the school can never be silently blank (which left DocuSign school empty).
  if (!teacher?.school_name || !teacher.school_name.trim()) {
    return refuse(NextResponse.json({ error: 'Please select or add your school before registering.' }, { status: 400 }))
  }
  if (!school_dpa_agreed) {
    return refuse(NextResponse.json({ error: 'Accept the School Data Terms to continue' }, { status: 400 }))
  }
  // A group needs at least 2 students. For a Student Manager that count is
  // "other students" — the SM is student #1 — so 1 other (2 total) is the floor.
  const minOtherStudents = registrant_role === 'student_manager' ? 1 : 2
  if (student_count < minOtherStudents) {
    return refuse(NextResponse.json({ error: 'A minimum of 2 students is required' }, { status: 400 }))
  }
  if (registrant_role === 'student_manager' && !teacher_poc?.email) {
    return refuse(NextResponse.json({ error: 'Student managers must nominate a teacher point of contact' }, { status: 400 }))
  }

  // deep review REG-5: validate the declared counts as non-negative integers
  // within the cap BEFORE any pricing or inserts. Negative counts previously
  // slipped through because the total-participants check only compared the sum
  // (adult_count:-10 + student_count:12 == total_participants:2), and a float
  // or absurd count was never rejected at all.
  if (!isValidCount(adult_count) || !isValidCount(student_count)) {
    return refuse(NextResponse.json(
      { error: `Group size is invalid. Adult and student counts must be whole numbers between 0 and ${GROUP_SIZE_MAX}.` },
      { status: 400 },
    ))
  }

  // deep review REG-5 (July #2, closing it out): billing is for the declared
  // seat count, but the `additional_adults` / `students` arrays were inserted
  // unbounded — a request billing 3 seats could insert 26 participants (each
  // with a consent envelope + Space access), and the join-link cap would then
  // treat the group as already full. Bind the arrays to the declared counts.
  // The absolute-count conversion (declaredAdultCount / declaredStudentCount)
  // happens below; here we use the same per-array expectations the "still to
  // add" messaging uses, so the two can never disagree. Only `add_now` sends
  // people now — the sheet / email-link methods provide the roster later.
  if (details_method === 'add_now') {
    const expectedAdditionalAdultsIn = registrant_role === 'student_manager'
      ? adult_count                   // SM: all adults are "additional"
      : Math.max(0, adult_count - 1)  // teacher: exclude themselves
    if ((students ?? []).length > student_count) {
      return refuse(NextResponse.json(
        { error: `You've entered more students (${(students ?? []).length}) than the ${student_count} you declared. Please adjust the group size or remove the extra entries.` },
        { status: 400 },
      ))
    }
    if ((additional_adults ?? []).length > expectedAdditionalAdultsIn) {
      return refuse(NextResponse.json(
        { error: `You've entered more additional adults (${(additional_adults ?? []).length}) than the ${expectedAdditionalAdultsIn} your group allows. Please adjust the group size or remove the extra entries.` },
        { status: 400 },
      ))
    }
  }

  const db = deps.serviceClient()
  const eventDate = event.date ?? null

  // S5 A7: every person is checked with the event's rules (lib/registration/
  // event-context). On a tenant's host the event's owner is read first, because its
  // rules decide the checks below, and every Member ID slot is unusable there. On
  // Stellr's hosts the event can only go ahead as Stellr's, so Stellr's rules apply,
  // exactly today's checks, and the owner is read after them: after Member IDs are
  // looked up in Stellr's own records, and before this event's registrations are read
  // and before anything is written. An event owned by anyone else then gets the
  // unknown event's answer, though a Member ID or date-of-birth answer can come first.
  const ownerCheck = () =>
    eventOwnerOrRefusal(event, event_slug, {
      db,
      requestTenantId: deps.requestTenantId,
      route: 'register/group',
    }, () => NextResponse.json({ error: 'Event not found' }, { status: 404 }))
  let context: RegistrationEventContext | null = null
  if (tenantHost) {
    const owned = await ownerCheck()
    if (!owned.ok) return refuse(owned.response)
    context = owned.context
  }
  const eligibility = context?.eligibility ?? stellrContext(event)

  const unusedMemberIds = new Set<ParticipantPayload>()
  const linkedSlotNames: LinkedSlotNames = new Map()
  if (details_method === 'add_now') {
    await resolveLinkedSlots(db, additional_adults, eligibility, linkedSlotNames, unusedMemberIds)
    await resolveLinkedSlots(db, students, eligibility, linkedSlotNames, unusedMemberIds)
    const badEmail = refuseBadEmails(body)
    if (badEmail) return refuse(badEmail)
  }

  const ageRefusal = checkDatesOfBirth(teacher, body, eligibility, unusedMemberIds)
  if (ageRefusal) return refuse(ageRefusal)

  if (!context) {
    const owned = await ownerCheck()
    if (!owned.ok) return refuse(owned.response)
    context = owned.context
  }
  // S5 A7: priced tenant events fail closed until S9. A fee, a card or invoice, or
  // seats paid one by one would each reach Stellr's Stripe account, so all are
  // refused here: before answerDuplicates, which can open a Checkout on an earlier
  // unpaid registration, and before anything is written.
  // Seats paid one by one (member_pays_individually) count as a payment only where
  // there is something to collect, a price on the event, which the first test below
  // already refuses. GroupRegistrationForm sends member_pays_individually for every
  // free, non-campaign event, where it means each seat is settled at nothing owed,
  // so on its own it is not a reason to refuse. "Invoice for some" is an invoice, and
  // "students share the teacher's cost" is a fee paid seat by seat, so both are too.
  if (
    !context.isPlatformOwner &&
    (event.stripePriceId || TENANT_REFUSED_PAYMENT_METHODS.has(body.payment_method))
  ) {
    return refuse(tenantPaymentsUnavailable())
  }

  // S5 A7: a priced tenant event was refused above, before this line. A duplicate's
  // answer can open a Checkout on the earlier registration, and for a tenant's event
  // it opens none and resends no pay link (payments: false).
  const duplicate = await answerDuplicates(db, body, teacher, event, sessionMember?.email, linkedSlotNames, {
    payments: context.isPlatformOwner,
  })
  if (duplicate) return refuse(duplicate)

  // The organiser is not on this event, but is on file: they sign in before
  // anything is written in that member's name (lib/registration/member-on-file).
  // People they enter are not asked, because the organiser is naming them, not
  // claiming to be them. Their profile is not rewritten, but the group's other
  // effects still follow for them: docs/TENANCY-S5.md, Owner decisions.
  // S5 A7: not on a tenant's event, which writes no member rows and makes no login,
  // and where asking would tell the tenant's form who is on file with Stellr.
  if (context.isPlatformOwner && !sessionMember) {
    const onFile = await findMemberOnFile(db, teacher.email, teacher.school_email)
    if (!onFile.ok) {
      console.error('[register/group] prior-member lookup failed:', onFile.error)
      return refuse(temporarilyUnavailable())
    }
    if (onFile.onFile) {
      return refuse(NextResponse.json(
        {
          code: SIGN_IN_REQUIRED,
          school_address_only: onFile.schoolAddressOnly,
          error: 'This email is already on file with Stellr. Sign in with the address you first used with us, then submit again. If you can’t, or a parent or guardian is helping you, contact us and we’ll help.',
        },
        { status: 409 },
      ))
    }
  }

  // Declared group size, normalised to ABSOLUTE totals so adult_count +
  // student_count == total participants regardless of role. For a teacher the
  // form's adult_count already includes them; for a student-manager the SM is the
  // group's first student, so add 1 to the "other students" count.
  const declaredAdultCount = adult_count
  const declaredStudentCount = registrant_role === 'student_manager' ? 1 + student_count : student_count

  // `total_participants` is client-supplied and drives BILLING (amount_due,
  // invoice amount, card checkout quantity), and the declared seats set the
  // join-link cap, so the two must agree. Bound to the declared seat count: any
  // mismatch is refused before any records, price lookup, or charge.
  const declaredSeats = declaredAdultCount + declaredStudentCount
  if ((total_participants ?? 0) !== declaredSeats) {
    return refuse(NextResponse.json(
      {
        error: `Participant count mismatch: ${total_participants ?? 0} total does not equal the ${declaredSeats} declared (${declaredAdultCount} adult, ${declaredStudentCount} student). Please refresh and try again.`,
      },
      { status: 400 },
    ))
  }

  const priced = await priceGroupRegistration(event, body)
  if (!priced.ok) return priced

  return {
    ok: true,
    group: {
      db,
      event,
      context,
      eventTitle,
      eventDate,
      isCampaign,
      teacher,
      hasSession: !!sessionMember,
      linkedSlotNames,
      declaredAdultCount,
      declaredStudentCount,
      price: priced.price,
    },
  }
}
