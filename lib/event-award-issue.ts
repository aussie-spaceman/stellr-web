import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CREDENTIAL_COLUMNS,
  issueCredential,
  reinstateCredential,
  revokeCredential,
  type CredentialRow,
  type CredentialTheme,
} from '@/lib/credentials'
import { sendCredentialIssuedEmail } from '@/lib/credentials-notify'
import { ASSIGNED_AWARD_TYPES, EVENT_AWARDS, awardCredentialTitle } from '@/lib/event-awards'
import { listAssignments, listEventStudents, type AssignmentRow } from '@/lib/event-certificates'

// ── Issuing judged awards ────────────────────────────────────────────────────
// Turns the draft in event_award_assignments into credentials, and reconciles
// on every re-run: a new assignment is issued, one given back is reinstated,
// one taken away is revoked. Idempotent — running it twice changes nothing.

export const AWARD_REVOKED_REASON = 'Award reassigned by the judges'

async function awardCredentials(db: SupabaseClient, slug: string): Promise<CredentialRow[]> {
  const { data, error } = await db
    .from('credentials')
    .select(CREDENTIAL_COLUMNS)
    .eq('event_slug', slug)
    .eq('source', 'event')
    .in('award_type', ASSIGNED_AWARD_TYPES)
    .is('tombstoned_at', null)
  if (error) throw new Error(`[event-awards] credentials: ${error.message}`)
  return (data ?? []) as CredentialRow[]
}

const key = (participantId: string | null, awardType: string | null) => `${participantId}:${awardType}`

export interface AwardPlan {
  toIssue: AssignmentRow[]
  toRevoke: CredentialRow[]
}

/** Pure: what issuing would change, given the draft and what is live. */
export function planAwardIssue(assignments: AssignmentRow[], credentials: CredentialRow[]): AwardPlan {
  const live = new Set(credentials.filter((c) => c.status === 'issued').map((c) => key(c.participant_id, c.award_type)))
  const wanted = new Set(assignments.map((a) => key(a.participant_id, a.award_type)))
  return {
    toIssue: assignments.filter((a) => !live.has(key(a.participant_id, a.award_type))),
    toRevoke: credentials.filter((c) => c.status === 'issued' && !wanted.has(key(c.participant_id, c.award_type))),
  }
}

/** How many changes are waiting for "Issue awards". */
export async function pendingAwardChanges(db: SupabaseClient, slug: string): Promise<number> {
  const [assignments, credentials] = await Promise.all([listAssignments(db, slug), awardCredentials(db, slug)])
  const plan = planAwardIssue(assignments, credentials)
  return plan.toIssue.length + plan.toRevoke.length
}

export interface IssueAwardsResult {
  issued: number
  reinstated: number
  revoked: number
  unchanged: number
  emailed: number
  failures: string[]
}

export async function issueAwards(
  db: SupabaseClient,
  slug: string,
  opts: { eventTitle: string; theme: CredentialTheme },
): Promise<IssueAwardsResult> {
  const [assignments, credentials, students] = await Promise.all([
    listAssignments(db, slug),
    awardCredentials(db, slug),
    listEventStudents(db, slug),
  ])
  const byId = new Map(students.map((s) => [s.id, s]))
  const held = new Map(credentials.map((c) => [key(c.participant_id, c.award_type), c]))
  const plan = planAwardIssue(assignments, credentials)
  const result: IssueAwardsResult = {
    issued: 0, reinstated: 0, revoked: 0, emailed: 0, failures: [],
    unchanged: assignments.length - plan.toIssue.length,
  }

  for (const a of plan.toIssue) {
    const p = byId.get(a.participant_id)
    const label = EVENT_AWARDS[a.award_type].label
    if (!p) {
      // Withdrawn since judging: the assignment stays, nothing is issued.
      result.failures.push(`${label}: participant ${a.participant_id} is no longer registered`)
      continue
    }
    try {
      let row: CredentialRow | null
      const revoked = held.get(key(a.participant_id, a.award_type))
      if (revoked) {
        row = await reinstateCredential(db, revoked.id)
        if (row) result.reinstated++
      } else {
        const def = EVENT_AWARDS[a.award_type]
        const out = await issueCredential(db, {
          source: 'event',
          awardType: a.award_type,
          participantId: p.id,
          memberId: p.member_id,
          eventSlug: slug,
          recipient: { firstName: p.first_name, lastName: p.last_name, dateOfBirth: p.date_of_birth },
          title: awardCredentialTitle(a.award_type, opts.eventTitle),
          description: def.description,
          criteria: def.criteria,
          issuer: 'Stellr Education',
          roleLabel: 'Student',
          award: def.label,
          theme: opts.theme,
        })
        row = out.row
        if (out.created) result.issued++
        else result.unchanged++
      }
      if (row) {
        const sent = await sendCredentialIssuedEmail(db, row, {
          firstName: p.first_name,
          email: p.email,
          guardianFirstName: p.emergency_contact_first_name,
          guardianEmail: p.emergency_contact_email,
        })
        if (sent) result.emailed++
      }
    } catch (err) {
      result.failures.push(`${p.first_name} ${p.last_name} (${label}): ${(err as Error).message}`)
    }
  }

  for (const c of plan.toRevoke) {
    const done = await revokeCredential(db, c.id, AWARD_REVOKED_REASON, null)
    if (done) result.revoked++
  }

  const { error } = await db
    .from('event_settings')
    .upsert({ event_slug: slug, awards_issued_at: new Date().toISOString() }, { onConflict: 'event_slug' })
  if (error) result.failures.push(`Could not record the issue time: ${error.message}`)

  return result
}
