import { ensureClerkUserAndSignInToken } from '@/lib/clerk-provisioning'
import { runGroupRegistrationFollowUp, type FollowUpPerson } from '@/lib/group-registration-followup'
import { runAfterResponse } from '@/lib/after-response'
import { linkMembersToSchoolByName } from '@/lib/school-link'
import { recordEventParticipation } from '@/lib/event-participation-sync'
import { syncObjectSpaceRoster, reconcileEventSpaceRoster } from '@/lib/space-inheritance'
import { syncMemberOptionSelections } from '@/lib/member-profile-options'
import { autoGrantBaseMembership } from '@/lib/auto-membership-grant'
import type { GatedGroup } from './gate'
import type { GroupBody } from './parse'
import type { SavedMembers, SavedParticipants } from './persist'

// POST /api/register/group, what hangs off the rows. Run on every registration
// today. Not everything here is Stellr-only: a tenant event can have minors, and
// the follow-up's agreement is their consent. Do not gate the whole of this on the
// platform owner.

// deep review QUAL-7 / 28 Oct 2026: the follow-up stops starting new work at this
// budget, so it always finishes inside the route's maxDuration. Anything left is
// picked up by the daily sweeps.
const FOLLOW_UP_BUDGET_MS = 250_000

/** After the members, before the registrant is linked. */
export async function runGroupMemberHooks(
  group: GatedGroup,
  body: GroupBody,
  regId: string,
  members: SavedMembers,
): Promise<void> {
  const { db, teacher, eventTitle } = group
  const { event_slug } = body
  const { memberIdMap, optionsByEmail, newlyCreatedEmails } = members

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
      recordEventParticipation(db, {
        memberId,
        eventSlug: event_slug,
        eventTitle,
        registrationId: regId,
      })
    )
  )

  // Grant every group member (registrant + entered participants) access to any
  // Space linked to this event — registering for the event confers Space access.
  // community_space_sources keys events by slug. Non-fatal, idempotent. (W7:
  // previously neither the joining members nor the organising teacher inherited
  // the event's Space.)
  await Promise.all(
    Object.values(memberIdMap)
      .filter((id): id is string => Boolean(id))
      .map((memberId) => syncObjectSpaceRoster(db, 'event', event_slug, memberId))
  )
  // Safety net: reconcile the event's linked Space rosters from the cohort roster.
  // If any per-member grant above failed transiently (the prior silent-swallow bug
  // that stranded the Nevada 2027 group), everyone the event knows about is still
  // enrolled. Non-fatal, idempotent.
  await reconcileEventSpaceRoster(db, event_slug)

  // Turn non-members into members: grant the free base tier (Explorer for
  // students, Educator for adults) to anyone who still has no membership after
  // the competition_registration grant rules ran above. Runs for events and
  // campaigns alike. Idempotent + non-fatal — existing members are untouched.
  await Promise.all(
    Object.values(memberIdMap)
      .filter((id): id is string => Boolean(id))
      .map((memberId) => autoGrantBaseMembership(db, memberId))
  )

  // Persist ethnicity/dietary selections onto the canonical join tables (030),
  // but only for members this request CREATED — these are member-profile data,
  // so an anonymous group submission must not rewrite an existing member's
  // selections (deep review C-3, finding REG-2). Same non-fatal contract.
  await syncMemberOptionSelections(
    db,
    [...optionsByEmail].map(([email, sel]) =>
      memberIdMap[email] && newlyCreatedEmails.has(email)
        ? { memberId: memberIdMap[email]!, ...sel }
        : null
    )
  )
}

/**
 * Provision a Clerk account + sign-in token so the registrant is silently
 * signed in on the confirmation step and can immediately open their group's
 * sheet from the member portal — no manual sign-up required. Non-fatal: a
 * Clerk hiccup must not fail the registration.
 * Already-signed-in registrants don't need provisioning or a sign-in token —
 * they have a Clerk session (and clerk_user_id) already. A Student Manager
 * under 13 gets no login here (COPPA guard): no parent can have signed yet.
 */
export async function provisionRegistrantLogin(group: GatedGroup, members: SavedMembers): Promise<string | null> {
  const { db, teacher, hasSession } = group
  const { registrantMemberIsNew, registrantMemberId } = members

  let signInToken: string | null = null
  if (!hasSession) {
    try {
      const provisioned = await ensureClerkUserAndSignInToken(
        teacher.email, teacher.first_name, teacher.last_name,
        { memberIsNew: registrantMemberIsNew, age: { dateOfBirth: teacher.date_of_birth } },
      )
      signInToken = provisioned.signInToken
      // Only link the Clerk id when a token was actually minted (both the Clerk
      // user and the member row are new this request). Linking otherwise would
      // bind a caller-created login to an existing member (deep review C-1). The
      // user.created webhook still links the legitimate returning case by email.
      if (signInToken && registrantMemberId) {
        await db.from('members').update({ clerk_user_id: provisioned.clerkUserId }).eq('id', registrantMemberId)
      }
    } catch (clerkErr) {
      console.error('Clerk provisioning (non-fatal):', clerkErr)
    }
  }
  return signInToken
}

/**
 * ── Agreements, logins and clearance notices: after the response ──────────
 * Each participant gets the right document by age/role: minors → parental
 * consent, adult attendees → Adult agreement, mentors → Mentor agreement.
 * These used to run inline and one by one, BEFORE the sheet, invoice
 * and confirmation email. A team of 18 outran the request budget (~5 s per
 * envelope) and the function was killed mid-loop: 9 students got nothing and
 * the organiser never got an invoice or a confirmation (28 Oct 2026). They now
 * run once the organiser has their answer (lib/group-registration-followup),
 * and anything that doesn't fit is picked up by the daily sweeps.
 */
export function scheduleGroupFollowUp(
  group: GatedGroup,
  body: GroupBody,
  regId: string,
  { registrantRow, participantsWithId }: SavedParticipants,
  requestStartedAt: number,
): void {
  const { db, teacher, eventTitle, eventDate } = group
  const { event_slug } = body

  const followUpPeople: FollowUpPerson[] = participantsWithId.flatMap(({ row, participantId }) =>
    participantId
      ? [{
          isRegistrant: row === registrantRow,
          agreement: {
            participantId,
            memberId:          row.member_id,
            eventSlug:         event_slug,
            eventTitle,
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
            grade:             row.grade,
          },
        }]
      : []
  )
  runAfterResponse('register/group', async () => {
    const outcome = await runGroupRegistrationFollowUp(db, {
      eventSlug: event_slug,
      eventTitle,
      eventDate,
      organiserName: `${teacher.first_name} ${teacher.last_name}`.trim(),
      people: followUpPeople,
      deadline: requestStartedAt + FOLLOW_UP_BUDGET_MS,
    })
    console.log('[register/group] follow-up', { registrationId: regId, ...outcome })
  })
}
