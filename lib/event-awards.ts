// ── Event awards: the fixed, global catalogue ────────────────────────────────
// Six certificates an event can give. Participation goes to every student;
// mentor (the Certificate of Appreciation) to every volunteer mentor assigned
// to the event; the other four are decided at the end of the event — three by
// the judges, Norm Chaffee Finalist by the volunteer mentors — and assigned by
// an admin or event manager (event_award_assignments), then issued as
// credentials.
// Labels match the certificate artwork word for word — one vocabulary on the
// print, the credential page and LinkedIn — except for an award renamed after
// its artwork was made (RELABELLED_AWARD_TYPES), which prints on the default
// design until new artwork is uploaded.
//
// Pure: imported by client components and route handlers alike.

export const AWARD_TYPES = ['participation', 'overall_champion', 'norm_chaffee', 'anita_gale', 'dick_edwards', 'mentor'] as const
export type AwardType = (typeof AWARD_TYPES)[number]
/** Decided awards — the ones an admin assigns per student. */
export type AssignedAwardType = Exclude<AwardType, 'participation' | 'mentor'>

/**
 * all = every student; team = a whole company; specialist = one per company;
 * finalists = any number of the champions, nominated by the mentors;
 * mentors = every volunteer mentor assigned to the event.
 */
export type AwardKind = 'all' | 'team' | 'specialist' | 'finalists' | 'mentors'

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
  norm_chaffee: {
    type: 'norm_chaffee',
    label: 'Norm Chaffee Finalist',
    kind: 'finalists',
    description: 'For excellence at this event.',
    criteria: 'Nominated by the volunteer mentors from the winning company for excellence at the competition.',
  },
  anita_gale: {
    type: 'anita_gale',
    label: 'Award for Creative Vision',
    kind: 'specialist',
    description:
      'Engineering Vision (with a capital V!) requires tenacity, communication, and attention to detail. Awarded for exhibiting all of these traits.',
    criteria: "Chosen by the judges from their company for creative vision.",
  },
  dick_edwards: {
    type: 'dick_edwards',
    label: 'Award for Quiet Leadership',
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

export const ASSIGNED_AWARD_TYPES: AssignedAwardType[] = ['overall_champion', 'norm_chaffee', 'anita_gale', 'dick_edwards']

/**
 * Awards renamed after credentials carrying them were issued. A credential
 * stores its award label as text — `award`, and the prefix of `title`
 * ("<label> — <event>") — so issued rows keep the wording they were issued
 * with, and every surface that shows a credential passes it through
 * relabelIssuedAward(). The stored rows are never rewritten. The award type
 * keys themselves are internal and never shown.
 */
export const RELABELLED_AWARD_TYPES: readonly AwardType[] = ['anita_gale', 'dick_edwards']

/** An award whose uploaded certificate artwork predates its current label: its
 *  PDF uses the default design rather than the artwork, until new artwork is
 *  uploaded and this list is cleared. */
export function artworkSupersededFor(t: string | null | undefined): boolean {
  return isAwardType(t) && RELABELLED_AWARD_TYPES.includes(t)
}

/**
 * The credential as it should be shown: for a renamed award, the current label
 * in `award` and in front of the event in `title`. Anything else unchanged.
 */
export function relabelIssuedAward<T extends { award_type?: string | null; award?: string | null; title: string }>(row: T): T {
  const t = row.award_type
  if (!isAwardType(t) || !RELABELLED_AWARD_TYPES.includes(t)) return row
  const label = EVENT_AWARDS[t].label
  const sep = row.title.indexOf(' — ')
  return { ...row, award: label, title: sep >= 0 ? `${label}${row.title.slice(sep)}` : label }
}
export const SPECIALIST_AWARD_TYPES: AssignedAwardType[] = ['anita_gale', 'dick_edwards']
/** A student holds at most one of these per event: the two specialist awards
 *  and Norm Chaffee Finalist. */
export const INDIVIDUAL_AWARD_TYPES: AssignedAwardType[] = ['norm_chaffee', 'anita_gale', 'dick_edwards']

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

export function isIndividual(t: AwardType): boolean {
  return (INDIVIDUAL_AWARD_TYPES as readonly AwardType[]).includes(t)
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
 * database's unique indexes are the backstop for the one-per-student rule; the
 * champion rule for finalists lives here only. Re-assigning a student to the
 * award they already hold is a no-op, not an error.
 */
export function assignmentConflict(existing: Assignment[], proposed: Assignment): string | null {
  const same = existing.find(
    (a) => a.participantId === proposed.participantId && a.awardType === proposed.awardType,
  )
  if (same) return null

  if (
    EVENT_AWARDS[proposed.awardType].kind === 'finalists' &&
    !existing.some((a) => a.participantId === proposed.participantId && a.awardType === 'overall_champion')
  ) {
    return `Only students holding ${EVENT_AWARDS.overall_champion.label} can be a ${EVENT_AWARDS[proposed.awardType].label}.`
  }
  if (!isIndividual(proposed.awardType)) return null

  const otherIndividual = existing.find(
    (a) => a.participantId === proposed.participantId && isIndividual(a.awardType),
  )
  if (otherIndividual) {
    const held = EVENT_AWARDS[otherIndividual.awardType]
    const already = held.kind === 'finalists' ? `Is already a ${held.label}` : `Already holds the ${held.label}`
    return `${already}. A student can win one individual award per event.`
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
