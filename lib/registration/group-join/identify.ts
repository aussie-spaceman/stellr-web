import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureClerkUserAndSignInToken } from '@/lib/clerk-provisioning'
import { AUTH_APP_URL } from '@/lib/env'
import { upsertMember } from '@/lib/member-sync'
import { childAwaitingConsentBlock } from '@/lib/pending-consent'
import { checkRegistrationAge } from '@/lib/registration-eligibility'
import { refuse, temporarilyUnavailable, type Refusable } from '../refusal'
import { personFromDetails, personFromProfile, type JoinMemberProfile, type JoinPerson } from './parse'

// POST /api/register/group-join, who is joining: a signed-in member, or someone
// new. Identity is resolved here, before persist admits anyone to the group. The
// order is pinned by app/api/register/group-join/route.branches.test.ts.

/** The person, their member row, and the sign-in token when one was minted. */
export interface GroupJoiner {
  person: JoinPerson
  memberId: string
  signInToken: string | null
}

export type IdentifyResult = Refusable<{ joiner: GroupJoiner }>

/** Signed-in member: their stored profile is authoritative. */
export async function identifySignedInMember(
  db: SupabaseClient,
  userId: string,
  eventDate: string | null,
): Promise<IdentifyResult> {
  // Decision 24, COPPA: a child whose parent has not consented joins
  // nothing until the parent signs (lib/pending-consent).
  const childBlock = await childAwaitingConsentBlock(db, userId)
  if (childBlock) return refuse(childBlock)

  const { data: member } = await db
    .from('members')
    .select('id, first_name, last_name, nickname, email, school_email, phone, date_of_birth, gender, grade, tshirt_size, age_bracket, event_role, ec_first_name, ec_last_name, ec_email, ec_phone, ec_relationship')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (!member) {
    return refuse(NextResponse.json({ error: 'Member profile not found. Please complete your Stellr profile first.' }, { status: 404 }))
  }
  // The stored date of birth is what the participant row and the agreement
  // use. Without a usable one the row cannot be saved, and the agreement
  // would not know whether a parent has to sign.
  const profileAge = checkRegistrationAge(member.date_of_birth, { eventDate })
  if (!profileAge.ok) {
    // Members cannot edit a date of birth on Account → Profile. A missing one
    // is added on the profile-completion page; a wrong one only staff can fix.
    return refuse(NextResponse.json(
      {
        code: profileAge.reason,
        error: profileAge.reason === 'dob_missing'
          ? `Please add your date of birth at ${AUTH_APP_URL}/account/onboarding, then open this link again.`
          : "The date of birth on your Stellr profile doesn't look right. Please contact Stellr to correct it, or ask your group organiser to add you.",
      },
      { status: 400 },
    ))
  }

  return {
    ok: true,
    joiner: {
      person: personFromProfile(member as JoinMemberProfile, profileAge),
      memberId: member.id,
      signInToken: null,
    },
  }
}

/** Brand-new participant: build from submitted details + provision Clerk. */
export async function identifyNewParticipant(
  db: SupabaseClient,
  details: Record<string, unknown> | undefined,
  eventDate: string | null,
): Promise<IdentifyResult> {
  const parsed = personFromDetails(details, eventDate)
  if (!parsed.ok) return parsed
  const { person } = parsed

  // Did this email already have a member row before we upsert it below?
  // Captured now so we can decide whether a silent sign-in token is safe — an
  // anonymous join must never get a session for an existing member (deep review
  // C-1). A failed read cannot tell new from existing, so it is a retryable
  // refusal, before anything is written.
  // Both addresses count (4 Nov 2026): upsertMember also links by the school
  // address, so a submitted school_email naming an existing member must not
  // read as "new" and mint a session for that member.
  const { data: priorJoiner, error: priorJoinerError } = await db
    .from('members').select('id').eq('email', person.email).maybeSingle()
  const { data: priorBySchool, error: priorBySchoolError } = await db
    .from('members').select('id').eq('school_email', person.email).limit(1).maybeSingle()
  const { data: priorSchoolAddr, error: priorSchoolAddrError } = person.school_email && person.school_email !== person.email
    ? await db.from('members').select('id').eq('email', person.school_email).maybeSingle()
    : { data: null, error: null }
  const priorLookupError = priorJoinerError ?? priorBySchoolError ?? priorSchoolAddrError
  if (priorLookupError) {
    console.error('[register/group-join] prior-member lookup failed:', priorLookupError)
    return refuse(temporarilyUnavailable())
  }
  const memberIsNew = !priorJoiner && !priorBySchool && !priorSchoolAddr

  // Cross-reference against the existing membership database by email: someone
  // already on file (added by an organiser, a past event, or another group's
  // sheet) keeps their record as-is and we just link the participant to it.
  // This is an UNAUTHENTICATED join link, so submitted details must never
  // rewrite an existing member's profile (deep review C-3, finding REG-2) —
  // they live on the participant row below. A brand-new email is still created.
  const memberId = await upsertMember(db, {
    email: person.email,
    school_email: person.school_email,
    first_name: person.first_name,
    last_name: person.last_name,
    nickname: person.nickname,
    phone: person.phone,
    date_of_birth: person.date_of_birth,
    gender: person.gender,
    grade: person.grade,
    t_shirt_size: person.t_shirt_size,
    age_bracket: person.age_bracket,
    event_role: person.event_role,
    health_conditions: person.health_conditions,
    ec_first_name: person.ec_first_name,
    ec_last_name: person.ec_last_name,
    ec_email: person.ec_email,
    ec_phone: person.ec_phone,
    ec_relationship: person.ec_relationship,
  }, { onExisting: 'skip' })

  if (!memberId) {
    console.error('Group join member upsert failed for', person.email)
    return refuse(NextResponse.json({ error: 'Failed to create your member account. Please try again.' }, { status: 500 }))
  }

  // Provision a passwordless Clerk account + sign-in token so the participant
  // is silently signed in on success (non-fatal — they can still sign in later
  // with the same email). Eagerly link the Clerk id to avoid a webhook race.
  // A child under 13 gets no login here (COPPA guard): their member row is
  // new, so no parent can have signed yet. The daily group sweep makes it later.
  let signInToken: string | null = null
  try {
    const provisioned = await ensureClerkUserAndSignInToken(person.email, person.first_name, person.last_name, {
      memberIsNew,
      age: { dateOfBirth: person.date_of_birth },
    })
    signInToken = provisioned.signInToken
    // Only link the Clerk id when a token was minted (both Clerk user and
    // member row new this request); otherwise linking would bind a
    // caller-created login to an existing member (deep review C-1).
    if (signInToken) {
      await db.from('members').update({ clerk_user_id: provisioned.clerkUserId }).eq('id', memberId)
    }
  } catch (clerkErr) {
    console.error('Clerk provisioning for group-join (non-fatal):', clerkErr)
  }

  return { ok: true, joiner: { person, memberId, signInToken } }
}
