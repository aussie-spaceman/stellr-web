/**
 * Survey data retention: 7 years after account deactivation (handover §7;
 * retention schedule row 27). Deletion is full — responses, answers,
 * invitations and privacy switches go through survey_purge_person(), nothing
 * de-identified is kept (§14.3). Legacy Google Forms imports carry no
 * identity and are not in scope.
 *
 * The clock, per person:
 *   - Has an account (the invitation or response is linked to a member, or the
 *     participant row is): 7 years after `members.deleted_at`, and only while
 *     the account is still inactive (`is_active = false`). Every deactivation
 *     path sets both — admin Deactivate, the deletion registry's soft delete,
 *     Clerk `user.deleted` — and reactivation through onboarding clears
 *     `deleted_at`, so a returning member's clock stops. An inactive member
 *     with no `deleted_at` has no clock; the report counts them.
 *   - No account, keyed to a participant row (one row per event): 7 years
 *     after 31 December of the event's year.
 *   - No account, keyed only to an email (a teacher who registered a group):
 *     7 years after the end of the year of the latest event that email was
 *     surveyed for, and only if no member has that email and every survey
 *     sent to it is due — the purge matches on the address, so it must not
 *     reach a newer survey.
 *
 * The "no account" rule is a proposal awaiting David's decision.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { purgeSurveyDataFor } from './purge'

export const SURVEY_RETENTION_YEARS = 7

// ── The rule (pure) ──────────────────────────────────────────────────────────

/** When a member's survey data falls due, or null while no clock is running. */
export function memberDueAt(m: { isActive: boolean | null; deletedAt: string | null }): Date | null {
  if (m.isActive !== false || !m.deletedAt) return null
  const d = new Date(m.deletedAt)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCFullYear(d.getUTCFullYear() + SURVEY_RETENTION_YEARS)
  return d
}

/** No account: 7 years after the end of the latest event year. */
export function noAccountDueAt(eventYears: (number | null | undefined)[]): Date | null {
  const years = eventYears.filter((y): y is number => typeof y === 'number' && y > 2000)
  if (!years.length) return null
  return new Date(Date.UTC(Math.max(...years) + 1 + SURVEY_RETENTION_YEARS, 0, 1))
}

export function isDue(dueAt: Date | null, now: Date): boolean {
  return dueAt !== null && dueAt.getTime() <= now.getTime()
}

// ── Planning ─────────────────────────────────────────────────────────────────

export type SubjectKind = 'member' | 'participant' | 'email'

export interface RetentionSubject {
  kind: SubjectKind
  /** member id, participant id, or lower-cased email. */
  id: string
  dueAt: string | null
  invitations: number
  responses: number
}

export interface RetentionPlan {
  asOf: string
  due: RetentionSubject[]
  /** Clock running, not yet due. */
  waiting: { member: number; participant: number; email: number; nextDueAt: string | null }
  /** Inactive members holding survey data with no deleted_at (no clock). */
  inactiveWithoutDate: number
  /** Email-only recipients held back because a member has the address or a newer survey went to it. */
  emailsHeld: number
  totals: { subjects: number; invitations: number; responses: number }
}

interface Inv {
  id: string
  distribution_id: string
  member_id: string | null
  participant_id: string | null
  email: string
  send_via: string
}
interface Resp {
  id: string
  invitation_id: string | null
  member_id: string | null
  participant_id: string | null
  event_year: number | null
}

const PAGE = 1000
const CHUNK = 200

async function readAll<T>(read: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await read(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE) return out
  }
}

async function byIds<T>(ids: string[], read: (slice: string[]) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await read(ids.slice(i, i + CHUNK))
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as T[]))
  }
  return out
}

/** Who is due on `now`. Reads only; changes nothing. */
export async function planSurveyRetention(db: SupabaseClient, now: Date = new Date()): Promise<RetentionPlan> {
  const [invs, resps, dists] = await Promise.all([
    readAll<Inv>((a, b) => db.from('survey_invitations').select('id, distribution_id, member_id, participant_id, email, send_via').order('id').range(a, b)),
    readAll<Resp>((a, b) => db.from('survey_responses').select('id, invitation_id, member_id, participant_id, event_year').eq('source', 'app').order('id').range(a, b)),
    readAll<{ id: string; event_date: string }>((a, b) => db.from('survey_distributions').select('id, event_date').order('id').range(a, b)),
  ])
  const yearOfDist = new Map(dists.map((d) => [d.id, Number(d.event_date.slice(0, 4))]))
  const invById = new Map(invs.map((i) => [i.id, i]))

  const participantIds = [...new Set([...invs, ...resps].map((r) => r.participant_id).filter(Boolean))] as string[]
  const parts = await byIds<{ id: string; member_id: string | null }>(participantIds, (s) => db.from('participants').select('id, member_id').in('id', s))
  const memberOfParticipant = new Map(parts.map((p) => [p.id, p.member_id]))

  // Each invitation and response belongs to exactly one subject.
  const ownerOf = (r: { member_id: string | null; participant_id: string | null }, inv?: Inv): { kind: SubjectKind; id: string } => {
    const member = r.member_id ?? inv?.member_id ?? (r.participant_id ? memberOfParticipant.get(r.participant_id) : null) ?? (inv?.participant_id ? memberOfParticipant.get(inv.participant_id) : null)
    if (member) return { kind: 'member', id: member }
    const participant = r.participant_id ?? inv?.participant_id
    if (participant) return { kind: 'participant', id: participant }
    return { kind: 'email', id: (inv?.email ?? '').toLowerCase() }
  }

  type Acc = { kind: SubjectKind; id: string; invitations: number; responses: number; years: number[] }
  const subjects = new Map<string, Acc>()
  const add = (o: { kind: SubjectKind; id: string }, field: 'invitations' | 'responses', year: number | null | undefined) => {
    const key = `${o.kind}:${o.id}`
    const s = subjects.get(key) ?? { kind: o.kind, id: o.id, invitations: 0, responses: 0, years: [] }
    s[field]++
    if (year) s.years.push(year)
    subjects.set(key, s)
  }
  for (const i of invs) add(ownerOf(i, i), 'invitations', yearOfDist.get(i.distribution_id))
  for (const r of resps) {
    const inv = r.invitation_id ? invById.get(r.invitation_id) : undefined
    add(ownerOf(r, inv), 'responses', r.event_year ?? (inv ? yearOfDist.get(inv.distribution_id) : null))
  }

  const memberIds = [...subjects.values()].filter((s) => s.kind === 'member').map((s) => s.id)
  const members = await byIds<{ id: string; is_active: boolean | null; deleted_at: string | null }>(memberIds, (s) =>
    db.from('members').select('id, is_active, deleted_at').in('id', s),
  )
  const memberById = new Map(members.map((m) => [m.id, m]))

  // Email-only subjects: never if a member has the address, and the address
  // must not have been surveyed (self) under any subject that isn't due.
  const emailIds = new Set([...subjects.values()].filter((s) => s.kind === 'email' && s.id).map((s) => s.id))
  // members.email is not always lower-cased: look up both spellings.
  const spellings = [...new Set([...emailIds, ...invs.map((i) => i.email).filter((e) => emailIds.has(e.toLowerCase()))])]
  const emailMembers = new Set(
    (await byIds<{ email: string | null }>(spellings, (s) => db.from('members').select('email').in('email', s))).map((m) => (m.email ?? '').toLowerCase()),
  )

  const plan: RetentionPlan = {
    asOf: now.toISOString(),
    due: [],
    waiting: { member: 0, participant: 0, email: 0, nextDueAt: null },
    inactiveWithoutDate: 0,
    emailsHeld: 0,
    totals: { subjects: 0, invitations: 0, responses: 0 },
  }
  const dueAtOf = new Map<string, Date | null>()
  for (const [key, s] of subjects) {
    if (s.kind === 'member') {
      const m = memberById.get(s.id)
      if (m && m.is_active === false && !m.deleted_at) plan.inactiveWithoutDate++
      dueAtOf.set(key, m ? memberDueAt({ isActive: m.is_active, deletedAt: m.deleted_at }) : null)
    } else {
      dueAtOf.set(key, noAccountDueAt(s.years))
    }
  }
  const selfEmailsNotDue = new Set<string>()
  for (const i of invs) {
    if (i.send_via !== 'self') continue
    const o = ownerOf(i, i)
    if (o.kind !== 'email' && !isDue(dueAtOf.get(`${o.kind}:${o.id}`) ?? null, now)) selfEmailsNotDue.add(i.email.toLowerCase())
  }

  const noteWaiting = (kind: SubjectKind, at: Date) => {
    plan.waiting[kind]++
    if (!plan.waiting.nextDueAt || at.toISOString() < plan.waiting.nextDueAt) plan.waiting.nextDueAt = at.toISOString()
  }
  for (const [key, s] of subjects) {
    const at = dueAtOf.get(key) ?? null
    if (!at) continue
    if (!isDue(at, now)) {
      noteWaiting(s.kind, at)
      continue
    }
    if (s.kind === 'email' && (!s.id || emailMembers.has(s.id) || selfEmailsNotDue.has(s.id))) {
      plan.emailsHeld++
      continue
    }
    plan.due.push({ kind: s.kind, id: s.id, dueAt: at.toISOString(), invitations: s.invitations, responses: s.responses })
    plan.totals.subjects++
    plan.totals.invitations += s.invitations
    plan.totals.responses += s.responses
  }
  plan.due.sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''))
  return plan
}

// ── Applying ─────────────────────────────────────────────────────────────────

export interface RetentionResult {
  purged: number
  responses: number
  invitations: number
  failures: { kind: SubjectKind; id: string; error: string }[]
}

/** Full deletion for every due subject. The caller decides whether to call this. */
export async function applySurveyRetention(db: SupabaseClient, plan: RetentionPlan, actor: string): Promise<RetentionResult> {
  const out: RetentionResult = { purged: 0, responses: 0, invitations: 0, failures: [] }
  for (const s of plan.due) {
    try {
      let r: { responses: number; invitations: number }
      if (s.kind === 'member') {
        r = await purgeSurveyDataFor(db, 'member', s.id, actor)
      } else {
        // Participant: its own rows only (no email, which could reach another
        // event). Email: only reached when every survey to it is due.
        const { data, error } = await db.rpc('survey_purge_person', {
          p_member_id: null,
          p_participant_ids: s.kind === 'participant' ? [s.id] : [],
          p_emails: s.kind === 'email' ? [s.id] : [],
          p_actor: actor,
        })
        if (error) throw new Error(error.message)
        r = data as { responses: number; invitations: number }
      }
      out.purged++
      out.responses += r.responses
      out.invitations += r.invitations
    } catch (err) {
      out.failures.push({ kind: s.kind, id: s.id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return out
}

/** A due list safe to print or store: ids for people with an account or participant row, masked emails. */
export function redactedDue(plan: RetentionPlan): { kind: SubjectKind; id: string; dueAt: string | null; invitations: number; responses: number }[] {
  return plan.due.map((s) => ({ ...s, id: s.kind === 'email' ? s.id.replace(/^(.).*@/, '$1***@') : s.id }))
}
