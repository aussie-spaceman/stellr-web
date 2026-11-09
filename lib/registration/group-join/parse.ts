import { NextResponse } from 'next/server'
import { resolveEmailPair } from '@/lib/member-email'
import {
  normalizeEventRole, normalizeGender, normalizeGrade, normalizeTshirt,
} from '@/lib/member-enums'
import { assertRegistrable, type EligibilityContext } from '../eligibility'
import { eligibilityRefused, refuse, type Refusable } from '../refusal'

// POST /api/register/group-join, who is joining, as data: no reads and no writes.

// A participant, normalised to the enum/shape the participants + members tables
// and DocuSign expect — built either from the signed-in member's profile, or
// from the details a brand-new participant types on the join page.
export interface JoinPerson {
  first_name: string
  last_name: string
  nickname: string | null
  email: string
  school_email?: string | null
  phone: string | null
  date_of_birth: string | null
  gender: string | null
  grade: string | null
  t_shirt_size: string | null
  age_bracket: string
  event_role: string
  ethnicity: string[]
  dietary_requirements: string[]
  health_conditions: string | null
  ec_first_name: string | null
  ec_last_name: string | null
  ec_email: string | null
  ec_phone: string | null
  ec_relationship: string | null
}

/** The columns of a members row that a signed-in join reads. */
export interface JoinMemberProfile {
  id: string
  first_name: string
  last_name: string
  nickname?: string | null
  email: string
  school_email?: string | null
  phone?: string | null
  date_of_birth: unknown
  gender?: string | null
  grade?: string | null
  tshirt_size?: string | null
  age_bracket: string
  event_role?: string | null
  ec_first_name?: string | null
  ec_last_name?: string | null
  ec_email?: string | null
  ec_phone?: string | null
  ec_relationship?: string | null
}

/** A signed-in member's profile, once its date of birth has passed the age check. */
export function personFromProfile(
  member: JoinMemberProfile,
  age: { dateOfBirth: string; isMinor: boolean },
): JoinPerson {
  // A minor on the event's date takes part as a student, whatever role and
  // bracket their profile holds (a school student manager stays one).
  const profileRole = normalizeEventRole(member.event_role ?? 'participant')

  return {
    first_name: member.first_name,
    last_name: member.last_name,
    nickname: member.nickname ?? null,
    email: member.email,
    school_email: member.school_email ?? null,
    phone: member.phone ?? null,
    date_of_birth: age.dateOfBirth,
    gender: member.gender ?? null,
    grade: member.grade ?? null,
    t_shirt_size: member.tshirt_size ?? null,
    age_bracket: age.isMinor ? 'high_school' : member.age_bracket,
    event_role: age.isMinor && profileRole !== 'school_student_manager' ? 'participant' : profileRole,
    ethnicity: [],
    dietary_requirements: [],
    health_conditions: null,
    ec_first_name: member.ec_first_name ?? null,
    ec_last_name: member.ec_last_name ?? null,
    ec_email: member.ec_email ?? null,
    ec_phone: member.ec_phone ?? null,
    ec_relationship: member.ec_relationship ?? null,
  }
}

/**
 * The details a brand-new participant submitted, or the answer that refuses them.
 * S5 A7: the date of birth goes through assertRegistrable (assertEligible and the consent rule) with the event's context:
 * for Stellr's events today's check, for a tenant's its minimum age.
 */
export function personFromDetails(
  details: Record<string, unknown> | undefined,
  eligibility: EligibilityContext,
): Refusable<{ person: JoinPerson }> {
  if (!details) {
    return refuse(NextResponse.json({ error: 'Please complete your details to join.' }, { status: 400 }))
  }
  const d = details as Record<string, string | string[] | undefined>
  const str = (v: unknown) => (v == null ? '' : String(v)).trim()
  const firstName = str(d.first_name)
  const lastName = str(d.last_name)
  // Personal takes primacy: with only a school address, it is the primary.
  const emails = resolveEmailPair({ email: d.email, school_email: d.school_email })
  const email = emails.email
  const dob = str(d.date_of_birth)

  if (!firstName || !lastName || !email || !dob) {
    return refuse(NextResponse.json({ error: 'First name, last name, email and date of birth are required.' }, { status: 400 }))
  }

  const ageCheck = assertRegistrable(dob, eligibility)
  if (!ageCheck.ok) return refuse(eligibilityRefused(ageCheck))

  const isMinor = ageCheck.isMinor
  const role = normalizeEventRole(str(d.type) || 'participant')
  const eventRole = isMinor && role !== 'school_student_manager' ? 'participant' : role

  return {
    ok: true,
    person: {
      first_name: firstName,
      last_name: lastName,
      nickname: str(d.nickname) || null,
      email,
      school_email: emails.school_email,
      phone: str(d.phone) || null,
      date_of_birth: ageCheck.dateOfBirth,
      gender: normalizeGender(d.gender),
      grade: normalizeGrade(d.grade),
      t_shirt_size: normalizeTshirt(d.t_shirt_size),
      age_bracket: isMinor ? 'high_school' : 'adult',
      event_role: eventRole,
      ethnicity: Array.isArray(d.ethnicity) ? d.ethnicity : [],
      dietary_requirements: Array.isArray(d.dietary_requirements) ? d.dietary_requirements : [],
      health_conditions: str(d.health_conditions) || null,
      ec_first_name: str(d.emergency_contact_first_name) || null,
      ec_last_name: str(d.emergency_contact_last_name) || null,
      ec_email: str(d.emergency_contact_email) || null,
      ec_phone: str(d.emergency_contact_phone) || null,
      ec_relationship: str(d.emergency_contact_relationship) || null,
    },
  }
}
