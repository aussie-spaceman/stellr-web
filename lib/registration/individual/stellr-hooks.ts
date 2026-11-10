import { dispatchAgreement } from '@/lib/docusign-agreements'
import { normalizeGrade } from '@/lib/member-enums'
import { autoGrantBaseMembership, recordParticipation } from '@/lib/community/event-hooks'
import { ensureClerkUserAndSignInToken } from '@/lib/clerk-provisioning'
import { attachOfferToRegistration } from '@/lib/scholarships'
import { sendTenantRegistrationConfirmation } from '../tenant-confirmation'
import type { GatedRegistration } from './gate'
import type { IndividualBody } from './parse'
import type { PersistedRegistration } from './persist'

/**
 * POST /api/register/individual, what follows the rows: the scholarship link,
 * event activity, membership, the agreement and the login. Run in this order on
 * every registration today. Returns the sign-in token, when one was minted.
 *
 * S5 A7: all of it is Stellr's, so a tenant's event gets none of it. The
 * registrant gets the tenant's confirmation email instead (B14's tenant share).
 * The agreement is the consent for a minor, and it is held for a tenant's event,
 * not sent as Stellr: Stellr's DocuSign templates and sender are Stellr's, and the
 * signing engine has no tenant sender yet (A11). Whether a tenant's minors may be
 * registered before that exists is an owner decision.
 */
export async function runIndividualHooks(
  gated: GatedRegistration,
  row: PersistedRegistration,
  body: IndividualBody,
): Promise<string | null> {
  const { db, email, scholarship, amountDueCents, eventTitle, dateOfBirth: dob } = gated
  const { regId, memberId, memberIsNew, participantId, resolvedRole, schoolState } = row
  const { event_slug, first_name, last_name, phone, grade, school_name, school_address_state } = body

  if (!gated.context.isPlatformOwner) {
    await sendTenantRegistrationConfirmation(db, {
      tenantId: gated.context.tenantId,
      to: email,
      firstName: first_name ?? '',
      eventTitle,
      kind: 'individual',
    })
    return null
  }

  // A scholarship offer now has its registration: link it, and record the
  // discounted amount due (the checkout below applies the coupon itself).
  if (scholarship) {
    await attachOfferToRegistration(db, scholarship, { id: regId, status: 'pending', amount_due_cents: amountDueCents }, memberId)
  }

  // Record this registration in event_participations so it appears in the
  // "Event Activity" lists on the member portal and admin member page.
  await recordParticipation(gated.context, db, { memberId, eventSlug: event_slug, eventTitle, registrationId: regId })

  // Turn a non-member registrant into a member: grant the free base tier
  // (Explorer / Educator / Alumni) if they still hold no membership after the
  // grant rules ran above. Idempotent + non-fatal — existing members untouched.
  await autoGrantBaseMembership(gated.context, db, memberId)

  // Trigger the appropriate DocuSign agreement (minor consent, or self-signed
  // adult/mentor participation agreement) for this participant.
  await dispatchAgreement(db, {
    participantId,
    memberId,
    eventSlug:         event_slug,
    eventTitle,
    firstName:         first_name,
    lastName:          last_name,
    email,
    phone,
    dateOfBirth:       dob,
    // resolvedRole, not the raw client event_role: a minor is forced to
    // 'participant' above, so the agreement router can't be handed 'Mentor'
    // for a child (deep review REG-6). classifyAgreement also fails safe on DOB.
    eventRole:         resolvedRole,
    schoolName:        school_name,
    // Prefer the canonical state on the linked school row — the form only
    // sends an address (and thus a state) for brand-new schools, so for an
    // existing-school selection school_address_state is empty.
    schoolState:       schoolState ?? school_address_state ?? null,
    guardianFirstName: body.emergency_contact_first_name,
    guardianLastName:  body.emergency_contact_last_name,
    guardianEmail:     body.emergency_contact_email,
    guardianPhone:     body.emergency_contact_phone,
    relationship:      body.emergency_contact_relationship,
    grade:             normalizeGrade(grade),
  })

  // Provision a Clerk account + sign-in token so a brand-new registrant is
  // silently signed in and lands in the member portal (/community) afterwards.
  // Already-signed-in members have a session + clerk_user_id already. Non-fatal
  // — a Clerk hiccup must never fail the registration. A child under 13 gets
  // no login here (COPPA guard): their member row is new, so no parent can
  // have signed yet.
  let signInToken: string | null = null
  if (!gated.hasSession) {
    try {
      const provisioned = await ensureClerkUserAndSignInToken(email, first_name, last_name, {
        memberIsNew,
        age: { dateOfBirth: dob },
      })
      signInToken = provisioned.signInToken
      // Only link the Clerk id when a token was actually minted (i.e. both the
      // Clerk user and the member row are new this request). Linking otherwise
      // would bind a caller-created login to an existing member (deep review C-1).
      if (signInToken && memberId) {
        await db.from('members').update({ clerk_user_id: provisioned.clerkUserId }).eq('id', memberId)
      }
    } catch (clerkErr) {
      console.error('Clerk provisioning (non-fatal):', clerkErr)
    }
  }
  return signInToken
}
