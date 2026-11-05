import { normalizeEmail } from '@/lib/member-enums'
import { primaryEmail, schoolEmailToStore } from '@/lib/member-email'

// POST /api/register/individual, the shape of what comes in. The route names each
// field itself (see the note there); nothing here validates: these are the types
// the client is expected to send, and the gate checks what it has to.

export interface IndividualBody {
  event_slug: string
  event_title?: string
  email?: string
  school_email?: string
  scholarship_token?: string
  first_name: string
  last_name: string
  nickname?: string
  phone: string
  date_of_birth: unknown
  grade: string
  gender: string
  ethnicity?: string[]
  t_shirt_size: string
  school_id?: string | null
  school_name: string
  school_address_street?: string | null
  school_address_city?: string | null
  school_address_state?: string | null
  school_address_zip?: string | null
  age_bracket: string
  event_role: string
  dietary_requirements?: string[]
  health_conditions?: string
  emergency_contact_first_name: string
  emergency_contact_last_name: string
  emergency_contact_email: string
  emergency_contact_phone: string
  emergency_contact_relationship: string
  merch_addons?: { variantId: string; qty: number }[]
}

/**
 * The registrant's two addresses. Personal takes primacy (lib/member-email): with
 * only a school address submitted, it is the primary. A session email always wins.
 */
export function registrantEmails(
  sessionEmail: string | null | undefined,
  body: Pick<IndividualBody, 'email' | 'school_email'>,
): { email: string; schoolEmail: string | null } {
  return {
    email: normalizeEmail(sessionEmail ?? primaryEmail(body.email, body.school_email)),
    schoolEmail: schoolEmailToStore(body.school_email),
  }
}

/**
 * School is mandatory: either an existing school id or a non-empty new-school
 * name. Checked on the server as well as in the form.
 */
export function hasSchool(body: Pick<IndividualBody, 'school_id' | 'school_name'>): boolean {
  return !!body.school_id || (typeof body.school_name === 'string' && body.school_name.trim().length > 0)
}
