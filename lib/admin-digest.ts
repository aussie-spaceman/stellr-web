// The member activity digest: what changed in the member database over a
// window (7, 30 or 90 days), compared with the window before it, plus every
// item still waiting on staff. One loader feeds both the admin dashboard
// (/admin) and the Friday email (app/api/cron/weekly-digest), so the two can't
// disagree.
//
// Outstanding items reuse the rules the rest of the app already applies:
// registrationPaid() for payments, the compliance audit for clearance, and the
// needs-paperwork finder for consent forms with nothing in flight.
//
// Report only. Nothing here writes.

import { EMPTY_STAFF_DIGEST, loadStaffDigest, type StaffDigest } from '@/lib/staff-digest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseServer } from '@/lib/supabase'
import { getEventsBySlugs } from '@/lib/events/repo'
import { eventLastDay, todayInAppZone } from '@/lib/utils'
import { isMinorOn } from '@/lib/age'
import { registrationPaid } from '@/lib/payment-status'
import { getComplianceAudit, type ComplianceAuditRow } from '@/lib/compliance-admin'
import { loadPaperworkGaps, type PaperworkGap } from '@/lib/esign/needs-paperwork'
import { ISSUE_FAILED_PREFIX } from '@/lib/docusign-agreements'
import { otherTenantEvents, stellrRows } from '@/lib/tenancy/stellr-scope'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { heldSigningInvites } from '@/lib/esign/outbox'

export const DIGEST_PERIODS = [7, 30, 90] as const
export type DigestPeriod = (typeof DIGEST_PERIODS)[number]

const DAY = 86_400_000
// PostgREST returns 1000 rows unless asked for more.
const ALL = 99_999

export interface DigestWindow {
  days: number
  /** ISO instants: [prevStart, start) is the comparison window, [start, end) this one. */
  prevStart: string
  start: string
  end: string
}

export function digestWindow(days: number, now = new Date()): DigestWindow {
  const start = new Date(now.getTime() - days * DAY)
  return {
    days,
    prevStart: new Date(start.getTime() - days * DAY).toISOString(),
    start: start.toISOString(),
    end: now.toISOString(),
  }
}

export interface Metric {
  current: number
  previous: number
}

/** A person in a list. `minor` lets the email leave a child's name out. */
export interface PersonRef {
  memberId: string | null
  name: string
  minor: boolean
  /** Role, tier, topic, event — whatever explains the row. */
  detail: string | null
  at: string
}

export interface PaymentItem {
  key: string
  kind: 'invoice' | 'checkout' | 'seats'
  /** Who owes it: the teacher or group for a group, the registrant otherwise. */
  who: string
  minor: boolean
  eventSlug: string
  eventTitle: string
  /** Null when the amount isn't known (seats paid individually). */
  amountCents: number | null
  detail: string
  since: string
}

export interface AwaitingSignature {
  id: string
  signerName: string
  /** The student the form is for, when it's a minor's consent form. */
  minorName: string | null
  eventTitle: string | null
  sentAt: string
  reminders: number
  memberId: string | null
}

export interface QueueItem {
  id: string
  label: string
  detail: string | null
  /** True when the label names a person who may be a minor. */
  personal: boolean
  at: string
  href: string
}

export interface MemberDigest {
  window: DigestWindow
  generatedAt: string
  growth: {
    newMembers: Metric & { byRole: Record<string, number>; people: PersonRef[] }
    registrations: Metric & { participants: number; items: PersonRef[] }
  }
  left: {
    deactivated: Metric & { people: PersonRef[] }
    lapsed: Metric & { people: PersonRef[] }
    unsubscribed: Metric & { people: PersonRef[] }
    withdrew: Metric & { items: PersonRef[] }
  }
  engagement: {
    activeMembers: Metric
    posts: Metric
    comments: Metric
    reactions: Metric
    chatMessages: Metric
    spaceJoins: Metric
    topSpaces: Array<{ id: string; name: string; posts: number; comments: number; messages: number }>
  }
  mentoring: {
    coachingRequests: Metric & { byStatus: Record<string, number>; people: PersonRef[] }
    cohortJoins: Metric & { people: PersonRef[] }
    volunteerSignups: Metric & { people: PersonRef[] }
    newMentors: Metric & { people: PersonRef[] }
  }
  outstanding: {
    awaitingSignature: AwaitingSignature[]
    paperworkGaps: Array<PaperworkGap & { minor: boolean }>
    verifications: {
      /** A licence to verify or a flagged check to decide: only a person can clear these. */
      review: ComplianceAuditRow[]
      inProcess: number
      /** No valid clearance on file: missing, expired, cancelled. */
      missing: number
    }
    payments: PaymentItem[]
    paymentsTotalCents: number
    queues: {
      coaching: QueueItem[]
      scholarships: QueueItem[]
      privacy: QueueItem[]
      deletions: QueueItem[]
    }
  }
  /** The Staff role (phase 4): grants, exports, unusual minor-record viewing, quarterly review. */
  staff?: StaffDigest
  /**
   * The mail outboxes' latest runs, from cron_runs (resend-quota-outbox.5). One
   * entry per outbox that has ever recorded a run; an outbox with none (crons
   * skip outside production) is left out rather than shown as stuck.
   */
  outboxes?: OutboxHealth[]
  /**
   * Other tenants' signing invitations held because their tenant has no usable
   * sender (B14b). A count only. Null when tenant mail is off or the count could
   * not be read. The dashboard shows it to platform admins only.
   */
  heldSigningInvites?: number | null
  /** Sections that failed to load, so a partial digest says so instead of showing zeros. */
  errors: string[]
}

// ── Outbox health (resend-quota-outbox.5) ───────────────────────────────────

export interface OutboxHealth {
  key: 'email' | 'signing'
  label: string
  /**
   * ok: the latest run succeeded, within the expected window. failed: the
   * latest run failed. overdue: the latest run did not fail, but nothing has
   * succeeded within the window (runs stopped, or were killed part-way).
   */
  state: 'ok' | 'failed' | 'overdue'
  lastRunAt: string
  /** Null when no recorded run has succeeded. */
  lastSuccessAt: string | null
  /** What the latest run reported, in plain words with counts only; never an address or an error's text. */
  detail: string | null
  windowHours: number
}

/** A finished cron_runs row, as the outbox check reads it. */
export interface OutboxRunRow {
  started_at: string
  finished_at: string | null
  ok: boolean | null
  errors: Array<{ where?: string; message?: string }> | null
  result: Record<string, unknown> | null
}

interface OutboxSpec {
  key: OutboxHealth['key']
  label: string
  job: string
  /** How long after a success the next one is due, with slack for a late run. */
  windowHours: number
  /**
   * For a job that does more than send mail: the step whose failure is the
   * outbox's. Null when any failure of the run is the outbox's.
   */
  step: string | null
}

/**
 * The outboxes that record cron_runs. The email outbox runs four times a day
 * (00:05, 06:05, 12:05, 18:05 UTC), so two hours past a slot is late. Signing
 * invitations waiting on the daily budget are drained as the 'outbox' step of
 * the daily esign-maintenance run (09:15 UTC); the event-emails and
 * docusign-reminders crons drain them too, but as a side task.
 */
export const OUTBOX_JOBS: readonly OutboxSpec[] = [
  { key: 'email', label: 'Email outbox', job: 'email-outbox', windowHours: 8, step: null },
  { key: 'signing', label: 'Signing invitations outbox', job: 'esign-maintenance', windowHours: 30, step: 'outbox' },
]

const OUTBOX_FAILURES: Record<string, string> = {
  stale: 'Mail has been waiting more than two days',
  rejected: 'Resend rejected some mail as invalid',
  drain: 'The run stopped with an error',
  outbox: 'Sending the waiting invitations failed',
}

function runFailed(run: OutboxRunRow, step: string | null): boolean {
  if (step === null) return run.ok === false
  return (run.errors ?? []).some((e) => e?.where === step)
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Counts from the latest run, as words. Reads numbers only, so no address or error text can reach the page. */
function outboxDetail(spec: OutboxSpec, run: OutboxRunRow, failed: boolean): string | null {
  const parts: string[] = []
  if (failed) {
    const wheres = [...new Set((run.errors ?? []).map((e) => e?.where).filter((w): w is string => !!w))]
      .filter((w) => spec.step === null || w === spec.step)
    for (const w of wheres) parts.push(OUTBOX_FAILURES[w] ?? 'The run reported a failure')
  }
  const result = (spec.step ? (run.result?.[spec.step] as Record<string, unknown> | undefined) : run.result) ?? {}
  const waiting = num(result.waiting)
  const oldest = num(result.oldestWaitingHours)
  if (spec.key === 'email' && waiting) parts.push(`${waiting} waiting${oldest != null ? `, the oldest for ${oldest} hours` : ''}`)
  return parts.length ? parts.join('. ') : null
}

/**
 * One outbox's health from its newest finished runs (newest first) and, when
 * none of those succeeded, the newest success found further back. Null when it
 * has no recorded run at all. Pure.
 */
export function outboxHealth(
  spec: OutboxSpec,
  runs: readonly OutboxRunRow[],
  olderSuccessAt: string | null,
  now: Date,
): OutboxHealth | null {
  const latest = runs[0]
  if (!latest) return null
  const success = runs.find((r) => !runFailed(r, spec.step))
  const lastSuccessAt = success ? success.finished_at ?? success.started_at : olderSuccessAt
  const latestFailed = runFailed(latest, spec.step)
  const overdue = !lastSuccessAt || now.getTime() - new Date(lastSuccessAt).getTime() > spec.windowHours * 3_600_000
  return {
    key: spec.key,
    label: spec.label,
    state: latestFailed ? 'failed' : overdue ? 'overdue' : 'ok',
    lastRunAt: latest.finished_at ?? latest.started_at,
    lastSuccessAt,
    detail: outboxDetail(spec, latest, latestFailed),
    windowHours: spec.windowHours,
  }
}

/** How many of a job's newest finished runs to look through for a success. */
const OUTBOX_RUNS_READ = 30

/** Every outbox's health, from cron_runs. Throws on a failed read so the section is reported, not hidden. */
export async function loadOutboxHealth(db: SupabaseClient, now = new Date()): Promise<OutboxHealth[]> {
  const cols = 'started_at, finished_at, ok, errors, result'
  const out = await Promise.all(OUTBOX_JOBS.map(async (spec) => {
    // Per-tenant child rows are never written for these jobs, so no parent_id
    // filter is needed (and naming the column would fail where it is missing).
    const runs = await rows(`${spec.job} runs`, db
      .from('cron_runs')
      .select(cols)
      .eq('job', spec.job)
      .not('finished_at', 'is', null)
      .order('started_at', { ascending: false })
      .limit(OUTBOX_RUNS_READ)) as unknown as OutboxRunRow[]
    let olderSuccessAt: string | null = null
    if (runs.length && !runs.some((r) => !runFailed(r, spec.step))) {
      // ok=true means every step succeeded, the outbox's included.
      const older = await rows(`${spec.job} last success`, db
        .from('cron_runs')
        .select(cols)
        .eq('job', spec.job)
        .eq('ok', true)
        .not('finished_at', 'is', null)
        .order('started_at', { ascending: false })
        .limit(1)) as unknown as OutboxRunRow[]
      olderSuccessAt = older[0] ? older[0].finished_at ?? older[0].started_at : null
    }
    return outboxHealth(spec, runs, olderSuccessAt, now)
  }))
  return out.filter((h): h is OutboxHealth => h !== null)
}

/** The outboxes that need a look: the latest run failed, or nothing has succeeded in time. */
export function stuckOutboxes(outboxes: readonly OutboxHealth[] | undefined): OutboxHealth[] {
  return (outboxes ?? []).filter((o) => o.state !== 'ok')
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** Which window an instant falls in, if either. */
export function windowOf(at: string | null | undefined, w: DigestWindow): 'current' | 'previous' | null {
  if (!at) return null
  if (at >= w.start && at < w.end) return 'current'
  if (at >= w.prevStart && at < w.start) return 'previous'
  return null
}

export function countMetric<T>(rows: T[], at: (r: T) => string | null | undefined, w: DigestWindow): Metric {
  const m = { current: 0, previous: 0 }
  for (const r of rows) {
    const which = windowOf(at(r), w)
    if (which) m[which]++
  }
  return m
}

export function personName(p: { first_name?: string | null; last_name?: string | null; email?: string | null } | null | undefined): string {
  const name = [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim()
  return name || p?.email || 'Unnamed member'
}

export function roleLabel(role: string | null | undefined): string {
  return (role ?? 'unknown').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

const newestFirst = (a: { at: string }, b: { at: string }) => b.at.localeCompare(a.at)

interface RegForPayment {
  id: string
  event_slug: string
  event_title: string | null
  type: string
  status: string
  created_at: string
  amount_due_cents: number | null
  invoice_requested: boolean | null
  invoice_paid_at: string | null
  member_pays_individually: boolean | null
  teacher_first_name: string | null
  teacher_last_name: string | null
  school_name: string | null
  group_name: string | null
  participants: Array<{
    id: string
    first_name: string | null
    last_name: string | null
    date_of_birth: string | null
    individual_payment_status: string | null
  }> | null
}

interface OpenInvoice {
  registration_id: string | null
  total_cents: number | null
  stripe_invoice_number: string | null
  created_at: string
}

/**
 * Unpaid registrations, as the roster pill and access gate see them
 * (lib/payment-status). Card and payment-link debts count for upcoming events
 * only; an unpaid invoice counts whatever the event date, because money owed
 * after the event is still owed. `isUpcoming` answers for an event slug.
 */
export function buildPaymentItems(
  regs: RegForPayment[],
  openInvoices: OpenInvoice[],
  isUpcoming: (slug: string) => boolean,
  titleOf: (slug: string, fallback: string | null) => string,
): PaymentItem[] {
  const invoiceByReg = new Map<string, OpenInvoice>()
  for (const inv of openInvoices) if (inv.registration_id) invoiceByReg.set(inv.registration_id, inv)

  const items: PaymentItem[] = []
  for (const reg of regs) {
    if (reg.status === 'withdrawn') continue
    const parts = reg.participants ?? []
    const title = titleOf(reg.event_slug, reg.event_title)
    const isGroup = reg.type === 'group' || reg.type === 'campaign'
    const lead = parts[0]
    const teacher = [reg.teacher_first_name, reg.teacher_last_name].filter(Boolean).join(' ')
    const who = isGroup
      ? [teacher, reg.group_name || reg.school_name].filter(Boolean).join(' · ') || 'Group registration'
      : personName(lead)
    const minor = !isGroup && !!lead && isMinorOn(lead.date_of_birth)

    if (reg.member_pays_individually) {
      if (!isUpcoming(reg.event_slug)) continue
      const unpaid = parts.filter((p) => p.individual_payment_status !== 'paid' && p.individual_payment_status !== 'waived' && p.individual_payment_status !== 'covered')
      if (unpaid.length === 0) continue
      items.push({
        key: `seats:${reg.id}`, kind: 'seats', who, minor, eventSlug: reg.event_slug, eventTitle: title,
        amountCents: null,
        detail: `${unpaid.length} of ${parts.length} paying individually ${unpaid.length === 1 ? 'hasn’t' : 'haven’t'} paid`,
        since: reg.created_at,
      })
      continue
    }

    const invoice = invoiceByReg.get(reg.id)
    const owes = (reg.amount_due_cents ?? 0) > 0 || !!invoice
    const paid = registrationPaid({ invoiceRequested: reg.invoice_requested, invoicePaidAt: reg.invoice_paid_at, status: reg.status })
    if (!owes || paid) continue
    if (reg.invoice_requested || invoice) {
      items.push({
        key: `invoice:${reg.id}`, kind: 'invoice', who, minor, eventSlug: reg.event_slug, eventTitle: title,
        amountCents: invoice?.total_cents ?? reg.amount_due_cents,
        detail: invoice?.stripe_invoice_number ? `Invoice ${invoice.stripe_invoice_number} unpaid` : 'Invoice unpaid',
        since: invoice?.created_at ?? reg.created_at,
      })
    } else if (isUpcoming(reg.event_slug)) {
      items.push({
        key: `checkout:${reg.id}`, kind: 'checkout', who, minor, eventSlug: reg.event_slug, eventTitle: title,
        amountCents: reg.amount_due_cents,
        detail: 'Checkout not completed',
        since: reg.created_at,
      })
    }
  }
  // Oldest debt first: it's the one most likely to have been forgotten.
  return items.sort((a, b) => a.since.localeCompare(b.since))
}

// ── Loader ───────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>
type PersonInfo = { name: string; minor: boolean; role: string | null }

/** Names for member ids, in chunks small enough for a GET URL. */
async function loadPeople(db: SupabaseClient, ids: Iterable<string | null | undefined>): Promise<Map<string, PersonInfo>> {
  const unique = [...new Set([...ids].filter((id): id is string => !!id))]
  const out = new Map<string, PersonInfo>()
  for (let i = 0; i < unique.length; i += 150) {
    const { data, error } = await db
      .from('members')
      .select('id, first_name, last_name, email, date_of_birth, event_role')
      .in('id', unique.slice(i, i + 150))
    if (error) throw new Error(`member lookup: ${error.message}`)
    for (const m of (data ?? []) as Row[]) {
      out.set(m.id as string, {
        name: personName(m as { first_name: string; last_name: string; email: string }),
        minor: isMinorOn(m.date_of_birth as string | null),
        role: (m.event_role as string | null) ?? null,
      })
    }
  }
  return out
}

/** Rows since the comparison window opened; throws so the section is reported, not zeroed. */
async function rows(label: string, query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Row[]> {
  const { data, error } = await query
  if (error) throw new Error(`${label}: ${error.message}`)
  return (data as Row[] | null) ?? []
}

// Event-scoped reads are limited to Stellr: this is Stellr's staff digest and
// dashboard. Most go through stellrRows; Spaces and mentoring groups are matched in
// code, below. members has no tenant column, so its reads are as wide as ever, and
// reactions name no Space (lib/cron-scope.ts, identityRead).
export async function loadMemberDigest(days: number, opts: { now?: Date; db?: SupabaseClient } = {}): Promise<MemberDigest> {
  const db = opts.db ?? supabaseServer()
  const w = digestWindow(days, opts.now)
  const since = w.prevStart
  const errors: string[] = []
  const inCurrent = (at: unknown) => windowOf(at as string | null, w) === 'current'

  // Each section loads on its own, so one failed query costs that section only.
  async function section<T>(name: string, fallback: T, load: () => Promise<T>): Promise<T> {
    try {
      return await load()
    } catch (err) {
      console.error(`[admin-digest] ${name} failed:`, err)
      errors.push(name)
      return fallback
    }
  }

  const zero = (): Metric => ({ current: 0, previous: 0 })

  const [growth, left, engagement, mentoring, outstanding] = await Promise.all([
    section<MemberDigest['growth']>('New members and registrations', {
      newMembers: { ...zero(), byRole: {}, people: [] as PersonRef[] },
      registrations: { ...zero(), participants: 0, items: [] as PersonRef[] },
    }, async () => {
      const [members, regs] = await Promise.all([
        rows('members', db.from('members').select('id, first_name, last_name, email, date_of_birth, event_role, created_at').gte('created_at', since).range(0, ALL)),
        rows('registrations', stellrRows(db.from('registrations')
          .select('id, event_slug, event_title, type, created_at, teacher_first_name, teacher_last_name, school_name, group_name, participants(first_name, last_name, email, date_of_birth)'))
          .gte('created_at', since).range(0, ALL)),
      ])
      const newMembers = members.filter((m) => inCurrent(m.created_at))
      const byRole: Record<string, number> = {}
      for (const m of newMembers) byRole[(m.event_role as string) ?? 'unknown'] = (byRole[(m.event_role as string) ?? 'unknown'] ?? 0) + 1
      const newRegs = regs.filter((r) => inCurrent(r.created_at))
      return {
        newMembers: {
          ...countMetric(members, (m) => m.created_at as string, w),
          byRole,
          people: newMembers.map((m) => ({
            memberId: m.id as string, name: personName(m), minor: isMinorOn(m.date_of_birth as string | null),
            detail: roleLabel(m.event_role as string), at: m.created_at as string,
          })).sort(newestFirst),
        },
        registrations: {
          ...countMetric(regs, (r) => r.created_at as string, w),
          participants: newRegs.reduce((n, r) => n + ((r.participants as Row[] | null)?.length ?? 0), 0),
          items: newRegs.map((r) => {
            const parts = (r.participants as Row[] | null) ?? []
            const isGroup = r.type === 'group' || r.type === 'campaign'
            const teacher = [r.teacher_first_name, r.teacher_last_name].filter(Boolean).join(' ')
            return {
              memberId: null,
              name: isGroup ? teacher || (r.group_name as string) || (r.school_name as string) || 'Group' : personName(parts[0]),
              minor: !isGroup && !!parts[0] && isMinorOn(parts[0].date_of_birth as string | null),
              detail: `${(r.event_title as string) ?? r.event_slug} · ${isGroup ? `group of ${parts.length}` : 'individual'}`,
              at: r.created_at as string,
            }
          }).sort(newestFirst),
        },
      }
    }),

    section<MemberDigest['left']>('Leavers', {
      deactivated: { ...zero(), people: [] as PersonRef[] },
      lapsed: { ...zero(), people: [] as PersonRef[] },
      unsubscribed: { ...zero(), people: [] as PersonRef[] },
      withdrew: { ...zero(), items: [] as PersonRef[] },
    }, async () => {
      const [deleted, unsubscribed, lapsedRows, withdrawn] = await Promise.all([
        rows('deactivated', db.from('members').select('id, first_name, last_name, email, date_of_birth, event_role, deleted_at').gte('deleted_at', since).range(0, ALL)),
        rows('unsubscribed', db.from('members').select('id, first_name, last_name, email, date_of_birth, event_role, marketing_unsubscribed_at').gte('marketing_unsubscribed_at', since).range(0, ALL)),
        rows('lapsed', db.from('member_memberships').select('member_id, renewal_status, updated_at, membership_tiers(name)').in('renewal_status', ['expired', 'cancelled']).gte('updated_at', since).range(0, ALL)),
        rows('withdrawn', stellrRows(db.from('registrations').select('id, event_slug, event_title, type, withdrawn_at, teacher_first_name, teacher_last_name, group_name, school_name, participants(first_name, last_name, email, date_of_birth)')).gte('withdrawn_at', since).range(0, ALL)),
      ])

      // A membership that lapsed while another is active was renewed or
      // upgraded, not left.
      const lapsedIds = [...new Set(lapsedRows.map((r) => r.member_id as string))]
      const { data: activeRows, error: activeError } = lapsedIds.length
        ? await db.from('member_memberships').select('member_id').eq('renewal_status', 'active').in('member_id', lapsedIds)
        : { data: [], error: null }
      if (activeError) throw new Error(`active memberships: ${activeError.message}`)
      const stillMember = new Set(((activeRows ?? []) as Row[]).map((r) => r.member_id as string))
      const lapsed = lapsedRows.filter((r) => !stillMember.has(r.member_id as string))
      const people = await loadPeople(db, lapsed.map((r) => r.member_id as string))

      const toPerson = (m: Row, at: string): PersonRef => ({
        memberId: m.id as string, name: personName(m), minor: isMinorOn(m.date_of_birth as string | null),
        detail: roleLabel(m.event_role as string), at,
      })
      return {
        deactivated: {
          ...countMetric(deleted, (m) => m.deleted_at as string, w),
          people: deleted.filter((m) => inCurrent(m.deleted_at)).map((m) => toPerson(m, m.deleted_at as string)).sort(newestFirst),
        },
        unsubscribed: {
          ...countMetric(unsubscribed, (m) => m.marketing_unsubscribed_at as string, w),
          people: unsubscribed.filter((m) => inCurrent(m.marketing_unsubscribed_at)).map((m) => toPerson(m, m.marketing_unsubscribed_at as string)).sort(newestFirst),
        },
        lapsed: {
          ...countMetric(lapsed, (r) => r.updated_at as string, w),
          people: lapsed.filter((r) => inCurrent(r.updated_at)).map((r) => {
            const p = people.get(r.member_id as string)
            const tier = (r.membership_tiers as { name?: string } | null)?.name ?? 'Membership'
            return {
              memberId: r.member_id as string, name: p?.name ?? 'Unknown member', minor: p?.minor ?? false,
              detail: `${tier} ${r.renewal_status}`, at: r.updated_at as string,
            }
          }).sort(newestFirst),
        },
        withdrew: {
          ...countMetric(withdrawn, (r) => r.withdrawn_at as string, w),
          items: withdrawn.filter((r) => inCurrent(r.withdrawn_at)).map((r) => {
            const parts = (r.participants as Row[] | null) ?? []
            const isGroup = r.type === 'group' || r.type === 'campaign'
            const teacher = [r.teacher_first_name, r.teacher_last_name].filter(Boolean).join(' ')
            return {
              memberId: null,
              name: isGroup ? teacher || (r.group_name as string) || (r.school_name as string) || 'Group' : personName(parts[0]),
              minor: !isGroup && !!parts[0] && isMinorOn(parts[0].date_of_birth as string | null),
              detail: (r.event_title as string) ?? (r.event_slug as string),
              at: r.withdrawn_at as string,
            }
          }).sort(newestFirst),
        },
      }
    }),

    section<MemberDigest['engagement']>('Community activity', {
      activeMembers: zero(), posts: zero(), comments: zero(), reactions: zero(), chatMessages: zero(), spaceJoins: zero(),
      topSpaces: [] as MemberDigest['engagement']['topSpaces'],
    }, async () => {
      const [allPosts, allComments, reactions, allChat, allJoins, otherSpaces] = await Promise.all([
        rows('posts', db.from('community_posts').select('space_id, author_member_id, created_at').neq('status', 'deleted').gte('created_at', since).range(0, ALL)),
        rows('comments', db.from('community_comments').select('author_member_id, created_at, community_posts(space_id)').neq('status', 'deleted').gte('created_at', since).range(0, ALL)),
        rows('reactions', db.from('community_reactions').select('author_member_id, created_at').gte('created_at', since).range(0, ALL)),
        // Space chat only: direct messages and cohort chat aren't space activity.
        rows('chat', db.from('chat_messages').select('author_member_id, created_at, chat_channels!inner(space_id)').not('chat_channels.space_id', 'is', null).is('deleted_at', null).gte('created_at', since).range(0, ALL)),
        rows('space joins', db.from('community_space_members').select('space_id, member_id, added_at').gte('added_at', since).range(0, ALL)),
        // Activity tables have no tenant column, so another tenant's Spaces are read
        // once and their activity left out. neq skips NULL, which counts as Stellr's.
        rows('other tenant spaces', db.from('community_spaces').select('id').neq('tenant_id', STELLR_TENANT_ID).range(0, ALL)),
      ])
      const otherSpaceIds = new Set(otherSpaces.map((s) => s.id as string))
      const inStellrSpace = (spaceId: unknown) => !otherSpaceIds.has(spaceId as string)
      const posts = allPosts.filter((p) => inStellrSpace(p.space_id))
      const comments = allComments.filter((c) => inStellrSpace((c.community_posts as { space_id?: string } | null)?.space_id))
      const chat = allChat.filter((m) => inStellrSpace((m.chat_channels as { space_id?: string } | null)?.space_id))
      const joins = allJoins.filter((j) => inStellrSpace(j.space_id))

      const actors = { current: new Set<string>(), previous: new Set<string>() }
      for (const r of [...posts, ...comments, ...reactions, ...chat]) {
        const which = windowOf(r.created_at as string, w)
        if (which && r.author_member_id) actors[which].add(r.author_member_id as string)
      }

      const bySpace = new Map<string, { posts: number; comments: number; messages: number }>()
      const bump = (spaceId: unknown, key: 'posts' | 'comments' | 'messages') => {
        if (!spaceId) return
        const s = bySpace.get(spaceId as string) ?? { posts: 0, comments: 0, messages: 0 }
        s[key]++
        bySpace.set(spaceId as string, s)
      }
      for (const p of posts) if (inCurrent(p.created_at)) bump(p.space_id, 'posts')
      for (const c of comments) if (inCurrent(c.created_at)) bump((c.community_posts as { space_id?: string } | null)?.space_id, 'comments')
      for (const m of chat) if (inCurrent(m.created_at)) bump((m.chat_channels as { space_id?: string } | null)?.space_id, 'messages')

      const topIds = [...bySpace.entries()]
        .sort(([, a], [, b]) => b.posts + b.comments + b.messages - (a.posts + a.comments + a.messages))
        .slice(0, 5)
      const { data: spaces } = topIds.length
        ? await db.from('community_spaces').select('id, name').in('id', topIds.map(([id]) => id))
        : { data: [] }
      const spaceName = new Map(((spaces ?? []) as Row[]).map((s) => [s.id as string, s.name as string]))

      return {
        activeMembers: { current: actors.current.size, previous: actors.previous.size },
        posts: countMetric(posts, (r) => r.created_at as string, w),
        comments: countMetric(comments, (r) => r.created_at as string, w),
        reactions: countMetric(reactions, (r) => r.created_at as string, w),
        chatMessages: countMetric(chat, (r) => r.created_at as string, w),
        spaceJoins: countMetric(joins, (r) => r.added_at as string, w),
        topSpaces: topIds.map(([id, s]) => ({ id, name: spaceName.get(id) ?? 'Space', ...s })),
      }
    }),

    section<MemberDigest['mentoring']>('Mentoring and coaching', {
      coachingRequests: { ...zero(), byStatus: {}, people: [] as PersonRef[] },
      cohortJoins: { ...zero(), people: [] as PersonRef[] },
      volunteerSignups: { ...zero(), people: [] as PersonRef[] },
      newMentors: { ...zero(), people: [] as PersonRef[] },
    }, async () => {
      const [coaching, allCohorts, volunteers, mentors, otherEvents] = await Promise.all([
        rows('coaching', db.from('coaching_requests').select('member_id, topic, status, created_at').gte('created_at', since).range(0, ALL)),
        rows('cohorts', db.from('cohort_members').select('member_id, relationship, added_at, mentoring_cohorts(name, campaign_ref, tenant_id)').gte('added_at', since).range(0, ALL)),
        rows('volunteers', stellrRows(db.from('volunteer_event_interest').select('member_id, event_title, event_slug, status, created_at')).gte('created_at', since).range(0, ALL)),
        rows('mentors', db.from('members').select('id, first_name, last_name, email, date_of_birth, created_at').eq('event_role', 'mentor').gte('created_at', since).range(0, ALL)),
        otherTenantEvents(db),
      ])
      // Matched here rather than with an inner join, which would hide a roster row
      // with no readable group. By its event as well as its own stamp: container-sync
      // creates an event's group with no sanity_event_id, and the derivation trigger
      // then stamps it Stellr's, whichever event it serves.
      const cohorts = allCohorts.filter((r) => {
        const c = r.mentoring_cohorts as { campaign_ref?: string | null; tenant_id?: string | null } | null
        if (c?.tenant_id && c.tenant_id !== STELLR_TENANT_ID) return false
        return !(c?.campaign_ref && otherEvents.slugs.has(c.campaign_ref))
      })
      const people = await loadPeople(db, [...coaching, ...cohorts, ...volunteers].map((r) => r.member_id as string))
      const ref = (r: Row, detail: string | null, at: string): PersonRef => {
        const p = people.get(r.member_id as string)
        return { memberId: r.member_id as string, name: p?.name ?? 'Unknown member', minor: p?.minor ?? false, detail, at }
      }
      const byStatus: Record<string, number> = {}
      for (const r of coaching) if (inCurrent(r.created_at)) byStatus[r.status as string] = (byStatus[r.status as string] ?? 0) + 1
      return {
        coachingRequests: {
          ...countMetric(coaching, (r) => r.created_at as string, w),
          byStatus,
          people: coaching.filter((r) => inCurrent(r.created_at)).map((r) => ref(r, (r.topic as string) || 'Coaching request', r.created_at as string)).sort(newestFirst),
        },
        cohortJoins: {
          ...countMetric(cohorts, (r) => r.added_at as string, w),
          people: cohorts.filter((r) => inCurrent(r.added_at)).map((r) => ref(
            r,
            `${(r.mentoring_cohorts as { name?: string } | null)?.name ?? 'Mentoring group'}${r.relationship && r.relationship !== 'participant' ? ` (${r.relationship})` : ''}`,
            r.added_at as string,
          )).sort(newestFirst),
        },
        volunteerSignups: {
          ...countMetric(volunteers.filter((r) => r.status !== 'withdrawn'), (r) => r.created_at as string, w),
          people: volunteers.filter((r) => r.status !== 'withdrawn' && inCurrent(r.created_at))
            .map((r) => ref(r, (r.event_title as string) ?? (r.event_slug as string), r.created_at as string)).sort(newestFirst),
        },
        newMentors: {
          ...countMetric(mentors, (r) => r.created_at as string, w),
          people: mentors.filter((m) => inCurrent(m.created_at)).map((m) => ({
            memberId: m.id as string, name: personName(m), minor: isMinorOn(m.date_of_birth as string | null), detail: 'Mentor', at: m.created_at as string,
          })).sort(newestFirst),
        },
      }
    }),

    loadOutstanding(db, section),
  ])
  const [staff, outboxes, held] = await Promise.all([
    section('staff', EMPTY_STAFF_DIGEST, () => loadStaffDigest(db, { start: w.start, end: w.end }, opts.now)),
    section('Mail outboxes', [] as OutboxHealth[], () => loadOutboxHealth(db, opts.now)),
    // Never throws: null when tenant mail is off or the count is unreadable.
    heldSigningInvites(db),
  ])

  return {
    window: w, generatedAt: new Date().toISOString(), growth, left, engagement, mentoring, outstanding, staff,
    outboxes, heldSigningInvites: held, errors,
  }
}

type Section = <T>(name: string, fallback: T, load: () => Promise<T>) => Promise<T>

async function loadOutstanding(db: SupabaseClient, section: Section): Promise<MemberDigest['outstanding']> {
  // Event dates, once, for every "is this still upcoming?" question.
  const eventInfo = await section('Event dates', { isUpcoming: (_: string | null) => true, titleOf: (_: string, f: string | null) => f ?? 'Event' }, async () => {
    const { data, error } = await stellrRows(db.from('registrations').select('event_slug')).neq('status', 'withdrawn').range(0, ALL)
    if (error) throw new Error(error.message)
    const slugs = [...new Set(((data ?? []) as Row[]).map((r) => r.event_slug as string).filter(Boolean))]
    const meta = await getEventsBySlugs(slugs)
    const bySlug = new Map(meta.map((m) => [m.slug.current, m]))
    const today = todayInAppZone()
    return {
      // An event Sanity can't date is kept: unknown is not "past".
      isUpcoming: (slug: string | null) => {
        if (!slug) return true
        const last = eventLastDay(bySlug.get(slug) ?? {})
        return !last || last >= today
      },
      titleOf: (slug: string, fallback: string | null) => bySlug.get(slug)?.title ?? fallback ?? slug,
    }
  })

  const [awaitingSignature, paperworkGaps, verifications, payments, queues] = await Promise.all([
    section('Consent forms awaiting signature', [] as AwaitingSignature[], async () => {
      const agreements = await rows('agreements', stellrRows(db.from('agreements')
        .select('id, envelope_id, envelope_type, status, signer_name, minor_name, event_title, event_slug, sent_at, created_at, reminder_count, member_id'))
        .in('status', ['created', 'sent', 'delivered'])
        .order('sent_at', { ascending: true })
        .range(0, ALL))
      return agreements
        // A failed issue isn't awaiting anyone: needs-paperwork lists it.
        .filter((a) => !(a.envelope_id as string | null)?.startsWith(ISSUE_FAILED_PREFIX))
        .filter((a) => eventInfo.isUpcoming(a.event_slug as string | null))
        .map((a) => ({
          id: a.id as string,
          signerName: (a.signer_name as string) || 'Signer',
          // minor_name holds the participant on every agreement, adult or not;
          // only a 'minor' envelope is a child's form signed by a guardian.
          minorName: a.envelope_type === 'minor' ? (a.minor_name as string | null) || null : null,
          eventTitle: (a.event_title as string | null) ?? null,
          sentAt: (a.sent_at as string) ?? (a.created_at as string),
          reminders: (a.reminder_count as number | null) ?? 0,
          memberId: (a.member_id as string | null) ?? null,
        }))
    }),

    section('Consent forms needing action', [] as Array<PaperworkGap & { minor: boolean }>, async () => {
      const gaps = await loadPaperworkGaps(db, undefined, { stellrOnly: true })
      const ids = gaps.map((g) => g.participantId)
      const dob = new Map<string, string | null>()
      for (let i = 0; i < ids.length; i += 150) {
        const { data } = await db.from('participants').select('id, date_of_birth').in('id', ids.slice(i, i + 150))
        for (const p of (data ?? []) as Row[]) dob.set(p.id as string, (p.date_of_birth as string | null) ?? null)
      }
      return gaps.map((g) => ({ ...g, minor: isMinorOn(dob.get(g.participantId) ?? null) }))
    }),

    section('Verifications', { review: [] as ComplianceAuditRow[], inProcess: 0, missing: 0 }, async () => {
      const audit = await getComplianceAudit()
      return {
        review: audit.reviewQueue,
        inProcess: audit.counts.in_process,
        missing: audit.counts.invalid + audit.counts.expired + audit.counts.cancelled,
      }
    }),

    section('Payments', [] as PaymentItem[], async () => {
      const [regs, invoices] = await Promise.all([
        rows('registrations', stellrRows(db.from('registrations')
          .select(`id, event_slug, event_title, type, status, created_at, amount_due_cents, invoice_requested, invoice_paid_at,
            member_pays_individually, teacher_first_name, teacher_last_name, school_name, group_name,
            participants(id, first_name, last_name, date_of_birth, individual_payment_status)`))
          .neq('status', 'withdrawn')
          .range(0, ALL)),
        rows('group invoices', stellrRows(db.from('group_invoices').select('registration_id, total_cents, stripe_invoice_number, created_at')).eq('status', 'open').range(0, ALL)),
      ])
      return buildPaymentItems(
        regs as unknown as RegForPayment[],
        invoices as unknown as OpenInvoice[],
        (slug) => eventInfo.isUpcoming(slug),
        eventInfo.titleOf,
      )
    }),

    section('Admin queues', { coaching: [] as QueueItem[], scholarships: [] as QueueItem[], privacy: [] as QueueItem[], deletions: [] as QueueItem[] }, async () => {
      const [coaching, scholarships, privacy, deletions] = await Promise.all([
        rows('coaching', db.from('coaching_requests').select('id, member_id, topic, created_at').eq('status', 'pending').order('created_at').range(0, ALL)),
        rows('scholarships', stellrRows(db.from('scholarship_applications').select('id, first_name, last_name, event_title, created_at')).eq('status', 'submitted').order('created_at').range(0, ALL)),
        // 'unverified' waits on the requester confirming their email, not on staff.
        rows('privacy', db.from('privacy_requests').select('id, kind, status, created_at').in('status', ['verified', 'in_progress']).order('created_at').range(0, ALL)),
        rows('deletions', db.from('deletion_requests').select('id, entity_type, reason, created_at').eq('status', 'pending').order('created_at').range(0, ALL)),
      ])
      const people = await loadPeople(db, coaching.map((r) => r.member_id as string))
      return {
        coaching: coaching.map((r) => ({
          id: r.id as string, label: people.get(r.member_id as string)?.name ?? 'Member', personal: true,
          detail: (r.topic as string) || null, at: r.created_at as string, href: '/admin/academy/coaching',
        })),
        scholarships: scholarships.map((r) => ({
          id: r.id as string, label: personName(r), personal: true,
          detail: (r.event_title as string | null) ?? null, at: r.created_at as string, href: `/admin/scholarships/${r.id}`,
        })),
        privacy: privacy.map((r) => ({
          id: r.id as string, label: `${roleLabel(r.kind as string)} request`, personal: false,
          detail: r.status === 'in_progress' ? 'In progress' : 'Verified, not started', at: r.created_at as string, href: '/admin/privacy-requests',
        })),
        deletions: deletions.map((r) => ({
          id: r.id as string, label: `Delete ${roleLabel(r.entity_type as string).toLowerCase()}`, personal: false,
          detail: (r.reason as string | null) ?? null, at: r.created_at as string, href: '/admin/activity-log',
        })),
      }
    }),
  ])

  return {
    awaitingSignature,
    paperworkGaps,
    verifications,
    payments,
    paymentsTotalCents: payments.reduce((n, p) => n + (p.amountCents ?? 0), 0),
    queues,
  }
}

/** Total outstanding items, for a headline count. */
export function outstandingCount(o: MemberDigest['outstanding']): number {
  return (
    o.awaitingSignature.length + o.paperworkGaps.length + o.verifications.review.length + o.payments.length +
    o.queues.coaching.length + o.queues.scholarships.length + o.queues.privacy.length + o.queues.deletions.length
  )
}
