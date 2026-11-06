import { normalizeEventRole, normalizeEmail } from '@/lib/member-enums'
import { resolveEmailPair } from '@/lib/member-email'

// POST /api/register/group, the shape of what comes in. The route names each field
// itself (see the note there); nothing here validates: these are the types the
// client is expected to send, and the gate checks what it has to.

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

export interface ParticipantPayload {
  first_name: string; last_name: string; nickname?: string; email: string; school_email?: string | null; phone: string
  date_of_birth: string; grade?: string; gender: string; t_shirt_size: string
  age_bracket: string; event_role: string
  ethnicity?: string[]; dietary_requirements?: string[]; health_conditions?: string
  emergency_contact_first_name?: string; emergency_contact_last_name?: string
  emergency_contact_email?: string; emergency_contact_phone?: string
  emergency_contact_relationship?: string
  // Member-ID linking (organiser entered an existing Stellr Member ID + Accept).
  linked?: boolean
  existing_membership_id?: string
  // Set during server-side resolution — the linked member's id. When present the
  // participant is built from the on-file record and the member is NOT overwritten.
  _linked_member_id?: string | null
}

/** The registrant: a person who has a school, and whose role comes from the form. */
export interface TeacherPayload extends Omit<ParticipantPayload, 'event_role'> {
  event_role?: string
  school_name: string
  school_address_street?: string | null
  school_address_city?: string | null
  school_address_state?: string | null
  school_address_zip?: string | null
}

export interface TeacherPoC {
  first_name: string; last_name: string; email: string
}

export interface GroupBody {
  event_slug: string
  event_title?: string
  registrant_role: string
  teacher?: TeacherPayload | null
  teacher_poc?: TeacherPoC | null
  adult_count: number
  student_count: number
  total_participants: number
  details_method: string
  payment_method: string
  member_pays_individually: boolean
  additional_adults?: ParticipantPayload[] | null
  students?: ParticipantPayload[] | null
  school_dpa_agreed?: unknown
}

// deep review REG-5: a sane upper bound on a single group registration. The
// declared counts drive billing and the join-link cap; without a ceiling a
// request could declare (and insert) an arbitrarily large roster. 200 is well
// above any real school group and is a placeholder pending an owner decision.
export const GROUP_SIZE_MAX = 200
// A declared seat count must be a non-negative integer within the cap. Rejects
// floats, negatives (which could net off against each other to pass the
// total-participants equality check) and absurd sizes before any billing.
export const isValidCount = (n: unknown): n is number =>
  Number.isInteger(n) && (n as number) >= 0 && (n as number) <= GROUP_SIZE_MAX

// The "minor → participant" override must never strip an organiser of their
// role. A teacher / student-manager keeps it regardless of DOB — a test or
// mistyped birthdate previously downgraded the registrant to participant,
// which hid their own group from /account?tab=teams and 403'd team management.
// Everyone else (students, additional adults, mentors) follows the age rule.
// `isMinor` comes from lib/registration-eligibility, which fails closed: an
// unreadable date of birth is a minor (S0; it used to read NaN as an adult).
const ORGANISER_ROLES = new Set(['teacher', 'school_student_manager'])
export function resolveRoleForAge(rawRole: unknown, isMinor: boolean): string {
  const role = normalizeEventRole(rawRole)
  if (ORGANISER_ROLES.has(role)) return role
  return isMinor ? 'participant' : role
}

/** Everyone entered on the form, adults first: the order every step walks them in. */
export const enteredPeople = (body: Pick<GroupBody, 'additional_adults' | 'students'>): ParticipantPayload[] =>
  [...(body.additional_adults ?? []), ...(body.students ?? [])]

/**
 * Settles who the body names. The session email is authoritative for the registrant.
 * Email is the member dedup key, so every address is normalised up front: casing
 * never spawns a duplicate member, and the duplicate check compares like with like.
 * Edits the people in the body, which every later step reads.
 */
export function settleAddresses(body: GroupBody, sessionEmail: string | null | undefined): void {
  const { teacher, additional_adults, students } = body
  // Option A — when the registrant (teacher / student-manager) is signed in,
  // their session email is authoritative. This keeps the registrant bound to
  // their own member row and keeps one identity per person. Additional
  // adults and students are unaffected — group logic is otherwise unchanged.
  if (sessionEmail && teacher) {
    teacher.email = sessionEmail
  }

  if (teacher?.email) teacher.email = normalizeEmail(teacher.email)
  // Personal takes primacy (lib/member-email): a participant given only a
  // school address has it as their primary; school_email keeps the school one.
  for (const p of [...(additional_adults ?? []), ...(students ?? [])]) {
    if (!p) continue
    const pair = resolveEmailPair({ email: p.email, school_email: p.school_email })
    p.email = pair.email
    p.school_email = pair.school_email
  }
  // Server state: resolveLinkedSlots sets it when a Member ID resolves. Starts empty.
  for (const p of [teacher, ...(additional_adults ?? []), ...(students ?? [])]) {
    if (p) delete p._linked_member_id
  }
}
