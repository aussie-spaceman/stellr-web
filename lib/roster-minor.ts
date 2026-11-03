import { isKnownMinorOn, isMinorOn, onDate } from '@/lib/age'
import { classifyAgreement } from '@/lib/docusign'

// The role-aware minor rule for an event participant row, shared by the roster
// and check-in desk (lib/event-admin) and the event access gate
// (lib/access-gates). It lives here rather than in lib/event-admin so the gate,
// which runs on every portal page, does not load the roster's compliance and
// DocuSign-recipient modules to answer one question.

/**
 * An adult by role: the role alone picks an adult's agreement (teacher, mentor,
 * volunteer, chaperone, parent). A student role, or no role, is not.
 */
export function isAdultByRole(eventRole: string | null | undefined): boolean {
  const kind = classifyAgreement(eventRole, null)
  return kind != null && kind !== 'minor'
}

/**
 * Under 18 on the day of the event (today when the event has no date). With no
 * usable date of birth, a student row is presumed a minor (S0, 2 Nov 2026); an
 * adult by role (teacher, mentor, volunteer, chaperone) is not, since their
 * agreement is an adult's whatever the roster says about their age, and flagging
 * them as an outstanding minor consent would be wrong at the check-in desk.
 */
export function isRosterMinor(dateOfBirth: string | null, eventRole: string | null, eventDate?: string): boolean {
  const on = eventDate ? onDate(eventDate) : undefined
  return isAdultByRole(eventRole) ? isKnownMinorOn(dateOfBirth, on) : isMinorOn(dateOfBirth, on)
}
