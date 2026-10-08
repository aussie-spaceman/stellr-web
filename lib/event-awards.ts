// ── Event awards: the fixed, global catalogue ────────────────────────────────
// Five certificates an event can give. Participation goes to every student;
// mentor (the Certificate of Appreciation) to every volunteer mentor assigned
// to the event; the other three are judged at the end of the event and
// assigned by an admin or event manager (event_award_assignments), then
// issued as credentials.
// Labels match the certificate artwork word for word — one vocabulary on the
// print, the credential page and LinkedIn.
//
// Pure: imported by client components and route handlers alike.

export const AWARD_TYPES = ['participation', 'overall_champion', 'anita_gale', 'dick_edwards', 'mentor'] as const
export type AwardType = (typeof AWARD_TYPES)[number]
/** Judged awards — the ones an admin assigns per student. */
export type AssignedAwardType = Exclude<AwardType, 'participation' | 'mentor'>

/**
 * all = every student; team = a whole company; specialist = one per company;
 * mentors = every volunteer mentor assigned to the event.
 */
export type AwardKind = 'all' | 'team' | 'specialist' | 'mentors'

export interface AwardDef {
  type: AwardType
  label: string
  kind: AwardKind
  /** Credential description, from the certificate artwork. */
  description: string
  criteria: string
}

export const EVENT_AWARDS: Record<AwardType, AwardDef> = {
  participation: {
    type: 'participation',
    label: 'Certificate of Participation',
    kind: 'all',
    description: 'For professionalism, maturity, and engineering prowess during the competition.',
    criteria: 'Took part in the competition as a student.',
  },
  overall_champion: {
    type: 'overall_champion',
    label: 'Overall Champion',
    kind: 'team',
    description: 'Scientific knowledge, engineering prowess, and teamwork skills that resulted in the winning design.',
    criteria: 'A member of the company judged overall winner of the competition.',
  },
  anita_gale: {
    type: 'anita_gale',
    label: 'Anita Gale Award for Creative Vision',
    kind: 'specialist',
    description:
      'Engineering Vision (with a capital V!) requires tenacity, communication, and attention to detail. Awarded for exhibiting all of these traits.',
    criteria: "Chosen by the judges from their company for creative vision.",
  },
  dick_edwards: {
    type: 'dick_edwards',
    label: 'Dick Edwards Award for Quiet Leadership',
    kind: 'specialist',
    description:
      'Leadership comes in many guises; this award is for being the person in the room constantly pushing the team to excel without looking for any credit.',
    criteria: 'Chosen by the judges from their company for quiet leadership.',
  },
  mentor: {
    type: 'mentor',
    label: 'Certificate of Appreciation',
    kind: 'mentors',
    description: 'With thanks for volunteering as a mentor: guiding students through the competition with time, expertise, and encouragement.',
    criteria: 'Volunteered as a mentor at the competition.',
  },
}

export const ASSIGNED_AWARD_TYPES: AssignedAwardType[] = ['overall_champion', 'anita_gale', 'dick_edwards']
export const SPECIALIST_AWARD_TYPES: AssignedAwardType[] = ['anita_gale', 'dick_edwards']

export function isAwardType(v: unknown): v is AwardType {
  return typeof v === 'string' && (AWARD_TYPES as readonly string[]).includes(v)
}

export function isAssignedAwardType(v: unknown): v is AssignedAwardType {
  return isAwardType(v) && (ASSIGNED_AWARD_TYPES as readonly string[]).includes(v)
}

/** Credential title for a mentor, unless the event sets its own. */
export function mentorCredentialTitle(eventTitle: string): string {
  return `${eventTitle} — Volunteer Mentor`
}

export function isSpecialist(t: AwardType): boolean {
  return EVENT_AWARDS[t].kind === 'specialist'
}

/** Credential title — the name on LinkedIn. Participation keeps its own. */
export function awardCredentialTitle(t: AssignedAwardType, eventTitle: string): string {
  return `${EVENT_AWARDS[t].label} — ${eventTitle}`
}

// ── Assignment rules ─────────────────────────────────────────────────────────

export interface Assignment {
  awardType: AssignedAwardType
  participantId: string
  companyId: string | null
}

/**
 * Why a proposed assignment breaks the rules, or null if it is fine. The
 * database's unique indexes are the backstop; this is the friendly message.
 * Re-assigning a student to the award they already hold is a no-op, not an
 * error.
 */
export function assignmentConflict(existing: Assignment[], proposed: Assignment): string | null {
  const same = existing.find(
    (a) => a.participantId === proposed.participantId && a.awardType === proposed.awardType,
  )
  if (same) return null
  if (!isSpecialist(proposed.awardType)) return null

  const otherSpecialist = existing.find(
    (a) => a.participantId === proposed.participantId && isSpecialist(a.awardType),
  )
  if (otherSpecialist) {
    return `Already holds the ${EVENT_AWARDS[otherSpecialist.awardType].label}. A student can win one specialist award per event.`
  }
  return null
}

/**
 * The specialist winner a new pick replaces in the same company — one winner
 * per company per award, so choosing a new one swaps out the old.
 */
export function replacedSpecialist(existing: Assignment[], proposed: Assignment): Assignment | null {
  if (!isSpecialist(proposed.awardType)) return null
  return (
    existing.find(
      (a) =>
        a.awardType === proposed.awardType &&
        a.companyId === proposed.companyId &&
        a.participantId !== proposed.participantId,
    ) ?? null
  )
}
