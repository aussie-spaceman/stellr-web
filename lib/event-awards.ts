// ── Event awards: the fixed, global catalogue ────────────────────────────────
// Six certificates an event can give. Participation goes to every student;
// mentor (the Certificate of Appreciation) to every volunteer mentor assigned
// to the event; the other four are decided at the end of the event — Overall
// Champion by the judges, the other three by the volunteer mentors — and
// assigned by an admin or event manager (event_award_assignments), then issued
// as credentials.
// Labels are the full names, matching the certificate artwork word for word —
// one vocabulary on the print, the credential page and LinkedIn — except for an
// award renamed after its artwork was made (ARTWORK_SUPERSEDED_AWARD_TYPES),
// which prints on the default design until new artwork is uploaded. The public
// site uses the short names in PUBLIC_AWARDS instead.
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
    label: 'Overall Event Champions',
    kind: 'team',
    description: 'Scientific knowledge, engineering prowess, and teamwork skills that resulted in the winning design.',
    criteria: 'A member of the company judged overall winner of the competition.',
  },
  norm_chaffee: {
    type: 'norm_chaffee',
    label: 'Norm Chaffee Award for Engineering Excellence',
    kind: 'finalists',
    description: 'For excellence at this event.',
    criteria: 'Nominated by the volunteer mentors from the winning company for excellence at the competition.',
  },
  anita_gale: {
    type: 'anita_gale',
    label: 'Anita Gale Award for Creative Vision',
    kind: 'specialist',
    description:
      'Engineering Vision (with a capital V!) requires tenacity, communication, and attention to detail. Awarded for exhibiting all of these traits.',
    criteria: 'Chosen by the volunteer mentors from their company for creative vision.',
  },
  dick_edwards: {
    type: 'dick_edwards',
    label: 'Dick Edwards Award for Quiet Leadership',
    kind: 'specialist',
    description:
      'Leadership comes in many guises; this award is for being the person in the room constantly pushing the team to excel without looking for any credit.',
    criteria: 'Chosen by the volunteer mentors from their company for quiet leadership.',
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

// ── The public site ──────────────────────────────────────────────────────────
// The four decided awards as /competitions explains them. Every award has two
// names (David, 27 Oct 2026): the full `label` above, on the certificate, the
// credential and at the closing ceremony; and the short `name` here, used on
// the website — "Norm Chaffee Award for Engineering Excellence" is the
// "Engineering Excellence Award". Being in the winning company carries no
// Summer Camp invitation of its own — its standout engineers receive the
// Engineering Excellence Award, which does.

export interface PublicAward {
  type: AssignedAwardType
  name: string
  decidedBy: 'judges' | 'mentors'
  /** How many are given, as a short phrase. */
  count: string
  /** One sentence for the tile. */
  summary: string
  forWhat: string
  howChosen: string
  summerCamp: boolean
}

export const PUBLIC_AWARDS: PublicAward[] = [
  {
    type: 'anita_gale',
    name: 'Creative Vision Award',
    decidedBy: 'mentors',
    count: 'One per company',
    summary: 'For the student whose vision shaped their company’s design.',
    forWhat: EVENT_AWARDS.anita_gale.description,
    howChosen:
      'The volunteer mentors who work alongside each company all event choose one of its students.',
    summerCamp: true,
  },
  {
    type: 'dick_edwards',
    name: 'Quiet Leadership Award',
    decidedBy: 'mentors',
    count: 'One per company',
    summary: 'For the student who kept their team pushing to excel, without looking for credit.',
    forWhat: EVENT_AWARDS.dick_edwards.description,
    howChosen:
      'The volunteer mentors who work alongside each company all event choose one of its students.',
    summerCamp: true,
  },
  {
    type: 'overall_champion',
    name: 'Champions Award',
    decidedBy: 'judges',
    count: 'One company',
    summary: 'Every member of the company with the winning design.',
    forWhat: EVENT_AWARDS.overall_champion.description,
    howChosen:
      'Industry judges score each company’s final presentation or written proposal against the brief, and choose one winner.',
    summerCamp: false,
  },
  {
    type: 'norm_chaffee',
    name: 'Engineering Excellence Award',
    decidedBy: 'mentors',
    count: 'Several, from the winning company',
    summary: 'For the standout engineers in the winning company.',
    forWhat:
      'For the members of the winning company whose engineering stood out, beyond its Creative Vision Award and Quiet Leadership Award winners.',
    howChosen:
      'The winning company’s mentors nominate any number of its students. Each student can win one individual award, so that company’s Creative Vision Award and Quiet Leadership Award winners are not eligible.',
    summerCamp: true,
  },
]

/**
 * Awards renamed after credentials carrying them were issued. A credential
 * stores its award label as text — `award`, and the prefix of `title`
 * ("<label> — <event>") — so issued rows keep the wording they were issued
 * with, and every surface that shows a credential passes it through
 * relabelIssuedAward(). The stored rows are never rewritten. The award type
 * keys themselves are internal and never shown.
 */
export const RELABELLED_AWARD_TYPES: readonly AwardType[] = ['overall_champion', 'anita_gale', 'dick_edwards', 'norm_chaffee']

/** Awards whose uploaded certificate artwork predates their current label.
 *  Empty since the full names returned on 27 Oct 2026: the Creative Vision and
 *  Quiet Leadership artwork was made with them, and the Norm Chaffee artwork
 *  already carries its full name. Narrower than RELABELLED_AWARD_TYPES. */
export const ARTWORK_SUPERSEDED_AWARD_TYPES: readonly AwardType[] = []

/** An award whose uploaded certificate artwork predates its current label: its
 *  PDF uses the default design rather than the artwork, until new artwork is
 *  uploaded and this list is cleared. */
export function artworkSupersededFor(t: string | null | undefined): boolean {
  return isAwardType(t) && ARTWORK_SUPERSEDED_AWARD_TYPES.includes(t)
}

/** "the <label>" for running text, without doubling a label that starts with "The". */
export function theAward(t: AwardType): string {
  const label = EVENT_AWARDS[t].label
  return label.startsWith('The ') ? `the ${label.slice(4)}` : `the ${label}`
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
 *  and the Norm Chaffee Award. */
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
    return `Only members of the winning company (${EVENT_AWARDS.overall_champion.label}) can receive ${theAward(proposed.awardType)}.`
  }
  if (!isIndividual(proposed.awardType)) return null

  const otherIndividual = existing.find(
    (a) => a.participantId === proposed.participantId && isIndividual(a.awardType),
  )
  if (otherIndividual) {
    return `Already holds ${theAward(otherIndividual.awardType)}. A student can win one individual award per event.`
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
