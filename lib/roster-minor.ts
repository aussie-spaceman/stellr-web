import { isKnownMinorOn, isMinorOn, onDate } from '@/lib/age'
import { ADULT_ROLES } from '@/lib/membership-rules'

// The role-aware minor rule for an event participant row, shared by the roster
// and check-in desk (lib/event-admin) and the event access gate
// (lib/access-gates). It lives here rather than in lib/event-admin so the gate,
// which runs on every portal page, does not load the roster's compliance and
// DocuSign-recipient modules to answer one question.

const ADULT = new Set<string>(ADULT_ROLES)

/**
 * An adult by role: a role only an adult is registered under (teacher, mentor,
 * volunteer, parent, adult; ADULT_ROLES in lib/membership-rules). An allowlist,
 * so a student role, no role, the 'subscriber' placeholder and any value it
 * does not know are not adults. Read the way classifyAgreement reads
 * participants.event_role (any case, spaces as underscores), so a legacy
 * "Mentor" row counts as it always has.
 */
export function isAdultByRole(eventRole: string | null | undefined): boolean {
  return ADULT.has((eventRole ?? '').trim().toLowerCase().replace(/\s+/g, '_'))
}

/**
 * Under 18 on the day of the event (today when the event has no date). With no
 * usable date of birth, anyone who is not an adult by role is presumed a minor
 * (S0, 2 Nov 2026): a student, a row with no role, a 'subscriber' or a role
 * nobody recognises. An adult by role (teacher, mentor, volunteer, parent,
 * adult) is not, since their agreement is an adult's whatever the roster says
 * about their age, and flagging them as an outstanding minor consent would be
 * wrong at the check-in desk.
 */
export function isRosterMinor(dateOfBirth: string | null, eventRole: string | null, eventDate?: string): boolean {
  const on = eventDate ? onDate(eventDate) : undefined
  return isAdultByRole(eventRole) ? isKnownMinorOn(dateOfBirth, on) : isMinorOn(dateOfBirth, on)
}
