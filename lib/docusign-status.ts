// The single vocabulary for "where is this agreement up to", shared by the event
// roster, the admin Consent forms table, the member portal and the reminder cron.
//
// WHY (4 Sept 2026): those four surfaces each derived their own answer from an
// envelope-level status plus two integers, and disagreed. A 1-of-2 envelope read
// "Partially Complete" on the roster, "Awaiting signature" in the admin table
// (which never even selected the counts), "Partially complete · 1 of 2 signed"
// in the portal, and the reminder email simply asserted the guardian was the
// holdout without checking. None of them could name the outstanding person,
// which is the only thing anyone needs to know.
//
// Everything here is pure. Callers pass the envelope row plus its recipients
// (docusign_envelope_recipients, migration 148); this module decides what it means.

export type DocusignPill =
  | 'not_required'
  | 'not_issued'
  | 'issued'
  | 'partial'
  | 'bounced'
  | 'declined'
  | 'voided'
  | 'complete'
  | 'on_file'

export interface EnvelopeLike {
  status: string
  signers_total?: number | null
  signers_completed?: number | null
  /** Set when this row is coverage carried from previously signed paperwork. */
  reused_from?: string | null
}

export interface RecipientLike {
  name: string
  email: string
  role_name?: string | null
  status: string
  /** Null on a 'sent' recipient = never opened the signing link. */
  delivered_at?: string | null
  /**
   * Stellr signing only: it is this signer's turn, but their signing email is
   * still in the queue (the daily email limit was reached). Not "never opened":
   * they have nothing to open yet.
   */
  unsent?: boolean
}

export interface EnvelopeDescription {
  pill: DocusignPill
  /** Short pill text, e.g. "Partially Complete". */
  label: string
  /** One line naming who is outstanding, or null when nobody is. */
  detail: string | null
  /** Signers who still have to act — the answer to "who do I chase?". */
  waitingOn: RecipientLike[]
  /** Signers whose email address bounced (DocuSign 'autoresponded'). */
  bounced: RecipientLike[]
  /** Outstanding signers who have never opened the link. */
  neverOpened: RecipientLike[]
  /**
   * Outstanding signers DocuSign has not emailed yet, because an earlier signer
   * in the routing order must sign first (status 'created'). Consent envelopes
   * whose student and guardian share an inbox route the student second, so the
   * student sits here until the guardian signs. Never counted as "never opened":
   * there is nothing to open yet.
   */
  queued: RecipientLike[]
  /** Outstanding signers whose signing email has not gone out yet (Stellr signing). */
  unsent: RecipientLike[]
}

const PILL_LABELS: Record<DocusignPill, string> = {
  not_required: 'Not Required',
  not_issued:   'Not Issued',
  issued:       'Issued',
  partial:      'Partially Complete',
  bounced:      'Email Bounced',
  declined:     'Declined',
  voided:       'Voided',
  complete:     'Complete',
  on_file:      'On File',
}

export const PILL_CLASSES: Record<DocusignPill, string> = {
  not_required: 'bg-brand-hairline text-brand-muted-soft',
  not_issued:   'bg-red-100 text-red-700',
  issued:       'bg-red-100 text-red-700',
  partial:      'bg-orange-100 text-orange-700',
  // Red, not orange: a bounced address never resolves by waiting. Someone has to
  // correct the address and re-issue.
  bounced:      'bg-red-100 text-red-700',
  declined:     'bg-red-100 text-red-700',
  voided:       'bg-brand-hairline text-brand-muted-soft',
  complete:     'bg-green-100 text-green-700',
  on_file:      'bg-teal-100 text-teal-700',
}

/** Human wording for a DocuSign template role. */
export function roleLabel(roleName: string | null | undefined): string {
  switch ((roleName ?? '').toLowerCase()) {
    case 'guardian':             return 'parent/guardian'
    case 'minor':                return 'student'
    case 'adult':                return 'participant'
    case 'mentor':               return 'mentor'
    case 'volunteer':            return 'volunteer'
    case 'stellrrepresentative': return 'Stellr counter-signature'
    case 'member':               return 'member'
    default:                     return 'signer'
  }
}

function describeSigner(r: RecipientLike): string {
  const role = roleLabel(r.role_name)
  return r.name ? `${r.name} (${role})` : `${r.email} (${role})`
}

function joinNames(list: RecipientLike[]): string {
  const names = list.map(describeSigner)
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

const TERMINAL_RECIPIENT_STATUSES = new Set(['completed', 'declined'])

// DocuSign's recipient status for a signer whose turn in the routing order has
// not come yet. Distinct from 'sent' with no delivered_at (emailed, not opened).
const QUEUED_RECIPIENT_STATUS = 'created'

/**
 * Paperwork is required but no envelope exists at all — or none is required.
 * Kept here so the roster's "no envelope row" branch speaks the same vocabulary
 * as every other case rather than hand-rolling its own pill.
 */
export function describeMissingEnvelope(required: boolean): EnvelopeDescription {
  return {
    pill:  required ? 'not_issued' : 'not_required',
    label: PILL_LABELS[required ? 'not_issued' : 'not_required'],
    detail: required ? 'Paperwork is required but no envelope has been issued' : null,
    waitingOn: [], bounced: [], neverOpened: [], queued: [], unsent: [],
  }
}

export function describeEnvelope(
  env: EnvelopeLike,
  recipients: RecipientLike[] = [],
): EnvelopeDescription {
  const total = env.signers_total ?? Math.max(recipients.length, 1)
  const completed = env.signers_completed ?? recipients.filter((r) => r.status === 'completed').length

  const bounced = recipients.filter((r) => r.status === 'autoresponded')
  const waitingOn = recipients.filter(
    (r) => !TERMINAL_RECIPIENT_STATUSES.has(r.status) && r.status !== 'autoresponded',
  )
  const queued = waitingOn.filter((r) => r.status === QUEUED_RECIPIENT_STATUS)
  const active = waitingOn.filter((r) => r.status !== QUEUED_RECIPIENT_STATUS)
  const unsent = active.filter((r) => r.unsent)
  const neverOpened = active.filter((r) => !r.delivered_at && !r.unsent)

  const base = { waitingOn, bounced, neverOpened, queued, unsent }

  // Coverage rows carry paperwork signed for an earlier event; they are complete
  // by construction and have no recipients of their own.
  if (env.reused_from) {
    return { pill: 'on_file', label: PILL_LABELS.on_file, detail: null, ...base }
  }
  if (env.status === 'completed') {
    return { pill: 'complete', label: PILL_LABELS.complete, detail: null, ...base }
  }
  if (env.status === 'declined') {
    const who = recipients.find((r) => r.status === 'declined')
    return {
      pill: 'declined',
      label: PILL_LABELS.declined,
      detail: who ? `Declined by ${describeSigner(who)}` : 'Declined',
      ...base,
    }
  }
  if (env.status === 'voided') {
    return { pill: 'voided', label: PILL_LABELS.voided, detail: 'Voided — re-issue required', ...base }
  }

  // A bounced address outranks "partially complete": waiting will never resolve
  // it, and it is invisible everywhere else in the system.
  if (bounced.length > 0) {
    return {
      pill: 'bounced',
      label: PILL_LABELS.bounced,
      detail: `Email bounced for ${joinNames(bounced)} — correct the address and re-issue`,
      ...base,
    }
  }

  const partial = completed > 0 && completed < total
  const pill: DocusignPill = partial ? 'partial' : 'issued'

  let detail: string | null = null
  if (waitingOn.length > 0) {
    const parts: string[] = []
    const emailed = active.filter((r) => !r.unsent)
    if (emailed.length > 0) {
      const never = neverOpened.length === emailed.length
      parts.push(`Awaiting ${joinNames(emailed)}${never ? ' — never opened' : ''}`)
    }
    if (unsent.length > 0) {
      parts.push(`Signing email to ${joinNames(unsent)} not sent yet — goes out within a day (daily email limit)`)
    }
    if (queued.length > 0) {
      const before = active.length > 0
        ? [...new Set(active.map((r) => roleLabel(r.role_name)))].join(' and ')
        : 'earlier signer'
      parts.push(`${joinNames(queued)} queued — sent once the ${before} signs`)
    }
    detail = parts.join('; ')
  } else if (partial) {
    // Counts say partial but we have no recipient rows yet (envelope issued
    // before migration 148, or the webhook has not synced it). Say so rather
    // than inventing a name.
    detail = `${completed} of ${total} signed — outstanding signer unknown, re-sync from DocuSign`
  }

  return {
    pill,
    label: partial ? `${PILL_LABELS.partial} · ${completed} of ${total}` : PILL_LABELS.issued,
    detail,
    ...base,
  }
}
