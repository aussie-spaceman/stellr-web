// Clearance notices: tell an adult taking part in an event that they still need
// to be cleared — by a verified teaching license or a background check — before
// they work with students. The rule itself lives in lib/compliance.ts.
//
// Two triggers share one sender:
//   'registered' — a teacher registers a group; app/api/register/group calls
//                  notifyClearanceRequired once the registration has landed.
//   'reminder'   — the daily background-sync cron runs remindUnclearedAdults,
//                  which reminds every adult still uncleared from 14 days before
//                  their event through the day itself.
//
// A notice is a safeguarding requirement, not marketing. The email goes out
// directly through sendEmail — never notifyMember, whose email preference would
// let a member switch it off — and the in-app notification is written beside it.
//
// Each (member, event, reason) is sent at most once. The member_activity_log row
// written on send ('clearance_notice_sent', metadata.eventSlug + metadata.reason)
// is both the idempotency key and the audit trail, which is what makes "within
// 14 days" safe: a day the cron missed still sends, once.

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { emailLayout, escapeHtml as esc } from '@/lib/email-layout'
import { logActivity } from '@/lib/activity-log'
import { AUTH_APP_URL } from '@/lib/env'
import { getEventBySlug } from '@/lib/sanity'
import { formatDate } from '@/lib/utils'
import { daysUntil } from '@/lib/event-emails/schedule'
import { CLEARANCE_PATH } from '@/lib/compliance-links'
import {
  BC_REQUIRED_ROLES,
  deriveCompliance,
  loadComplianceRecordsByMemberIds,
  loadComplianceRecordsForMembers,
  type ComplianceSummary,
} from '@/lib/compliance'

const NOTICE_ACTION = 'clearance_notice_sent'

/** Reminders go out from this many days before the event through the day itself. */
export const REMINDER_WINDOW_DAYS = 14
/** Reminder emails one cron run may send; the rest go next run, still in the window. */
export const REMINDER_MAX_PER_RUN = 20
/** A registration older than this can't be for an event in the next two weeks. */
const REGISTRATION_LOOKBACK_DAYS = 400
const PAGE_SIZE = 1000
const ID_CHUNK = 100

export type ClearanceNoticeReason = 'registered' | 'reminder'

export interface ClearanceNoticeInput {
  memberId: string
  eventSlug: string
  eventTitle: string
  /** The event's date, YYYY-MM-DD; age and expiry are judged as of this day. */
  eventDate?: string | null
  reason: ClearanceNoticeReason
}

export type ClearanceNoticeSkip =
  /** A passed check or a verified license covers the event date. */
  | 'cleared'
  /** A minor on the event date. */
  | 'not_required'
  /** The next step is Stellr's, not the member's: a license with its photo
   *  awaiting verification, a flagged check awaiting a decision, or a decision
   *  against them (which a license does not override). */
  | 'staff_review'
  | 'already_sent'
  | 'member_not_found'
  | 'error'

export type ClearanceNoticeResult =
  | { sent: true; emailed: boolean; inApp: boolean }
  | { sent: false; reason: ClearanceNoticeSkip; error?: string }

/** Today's calendar date in Mountain time (the app zone), as YYYY-MM-DD. */
function todayMountain(now: Date): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
}

/** A usable YYYY-MM-DD from whatever the caller or Sanity handed us, else null. */
function calendarDate(value: string | null | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null
}

// The caller only asks about someone taking part in an event-facing role, so the
// requirement is already settled. Derive as that kind of role — the member row's
// own role when it is one, else 'adult' — so a stale 'subscriber' on the member
// row can't read as not_required. Age is still judged, so a minor drops out.
function clearanceRole(memberRole: string | null | undefined): string {
  const role = (memberRole ?? '').toLowerCase()
  return (BC_REQUIRED_ROLES as readonly string[]).includes(role) ? role : 'adult'
}

const isCleared = (s: ComplianceSummary) => s.state === 'valid_bc' || s.state === 'valid_license'

function nextStepIsStellrs(summary: ComplianceSummary, ref: Date): boolean {
  const { state, license, check } = summary
  if (state === 'flagged') return true
  if (check?.adjudication_outcome === 'not_cleared') return true
  // A license, photo attached, waiting for an admin to verify it: the member has
  // already done everything this email would ask of them.
  return !!license && !license.verified_at && !!license.document_path && new Date(license.expiry_date) >= ref
}

const noticeKey = (memberId: string, eventSlug: string, reason: string) => `${memberId}|${eventSlug}|${reason}`

/** Keys of every clearance notice already sent to these members. Throws on a
 *  failed read: without the ledger we can't know who has been told. */
async function sentNoticeKeys(db: SupabaseClient, memberIds: string[]): Promise<Set<string>> {
  const keys = new Set<string>()
  const unique = [...new Set(memberIds)]
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    const { data, error } = await db
      .from('member_activity_log')
      .select('member_id, metadata')
      .eq('action', NOTICE_ACTION)
      .in('member_id', unique.slice(i, i + ID_CHUNK))
    if (error) throw new Error(`notice ledger: ${error.message}`)
    for (const row of (data ?? []) as { member_id: string; metadata: Record<string, unknown> | null }[]) {
      const slug = row.metadata?.eventSlug
      const reason = row.metadata?.reason
      if (typeof slug === 'string' && typeof reason === 'string') keys.add(noticeKey(row.member_id, slug, reason))
    }
  }
  return keys
}

function awayPhrase(days: number | null): string {
  if (days === null || days < 0) return 'coming up'
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === 7) return 'a week away'
  if (days === 14) return 'two weeks away'
  return `${days} days away`
}

/**
 * The clearance email. Exported for tests and previews. Every interpolated value
 * in the HTML goes through `esc`; emailLayout escapes heading and preheader.
 */
export function clearanceNoticeEmail({
  firstName, eventTitle, eventDate, reason, daysAway, checkStarted, url,
}: {
  firstName: string | null
  eventTitle: string
  eventDate: string | null
  reason: ClearanceNoticeReason
  daysAway: number | null
  /** A background check is invited or running: point them at finishing it. */
  checkStarted: boolean
  url: string
}) {
  const hi = firstName?.trim() ? firstName.trim() : 'there'
  const date = eventDate ? formatDate(eventDate) : null
  const away = awayPhrase(daysAway)

  const subject =
    reason === 'reminder' ? `${eventTitle} is ${away}: clearance still needed` : `Clearance needed for ${eventTitle}`
  const introHtml =
    reason === 'reminder'
      ? `<p><strong>${esc(eventTitle)}</strong> is ${away}${date ? ` (${esc(date)})` : ''}, and we still need you cleared before the day.</p>`
      : `<p>You're bringing a group to <strong>${esc(eventTitle)}</strong>${date ? ` on <strong>${esc(date)}</strong>` : ''}. We're looking forward to it.</p>`
  const introText =
    reason === 'reminder'
      ? `${eventTitle} is ${away}${date ? ` (${date})` : ''}, and we still need you cleared before the day.`
      : `You're bringing a group to ${eventTitle}${date ? ` on ${date}` : ''}. We're looking forward to it.`
  const rule =
    'Every adult working with students at a Stellr event must be cleared first, by a verified teaching license or a background check. Neither is in place for you yet.'
  const ask = "The quickest route is your teaching license: add its details and a photo or scan in your account, and we'll verify it."
  const reply = "Easier by email? Reply with a copy of your license and we'll add it for you."
  const started = "Already started a background check? Finish it from the invitation email and you're set."

  const html = emailLayout({
    heading: reason === 'reminder' ? 'Clearance still needed' : 'One step before event day',
    preheader: 'Adults working with students need a teaching license or background check on file.',
    bodyHtml: `
        <p>Hi ${esc(hi)},</p>
        ${introHtml}
        <p>${rule}</p>
        <p>${ask}</p>
        <p style="margin:24px 0"><a href="${esc(url)}" style="display:inline-block;background:#3C6DF6;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Add your teaching license</a></p>
        <p style="color:#6b7280;font-size:14px">${reply}</p>${
          checkStarted ? `\n        <p style="color:#6b7280;font-size:14px">${started}</p>` : ''
        }`,
  })
  const text = [
    `Hi ${hi},`,
    introText,
    rule,
    ask,
    `Add your teaching license: ${url}`,
    reply,
    ...(checkStarted ? [started] : []),
    '— Stellr Education',
  ].join('\n\n')
  return { subject, html, text }
}

/**
 * Tell a member they need clearance for an event, by email and in-app, once per
 * (member, event, reason). Never throws: every outcome comes back as a result,
 * so a registration or a cron run can call it without a try/catch.
 */
export async function notifyClearanceRequired(
  db: SupabaseClient,
  input: ClearanceNoticeInput,
  opts: { now?: Date } = {},
): Promise<ClearanceNoticeResult> {
  const { memberId, eventSlug, eventTitle, reason } = input
  try {
    const now = opts.now ?? new Date()
    const eventDate = calendarDate(input.eventDate)

    const { data: member, error: memberError } = await db
      .from('members')
      .select('id, email, first_name, event_role, date_of_birth')
      .eq('id', memberId)
      .maybeSingle()
    if (memberError) throw new Error(`member: ${memberError.message}`)
    if (!member) return { sent: false, reason: 'member_not_found' }

    // The member exists, so a missing entry means the records read failed —
    // not "no license, no check". Don't tell a possibly-cleared person otherwise.
    const records = (await loadComplianceRecordsByMemberIds(db, [memberId])).get(memberId)
    if (!records) throw new Error('compliance records could not be read')

    const summary = deriveCompliance(
      records.license,
      records.checks,
      clearanceRole(member.event_role as string | null),
      member.date_of_birth as string | null,
      eventDate ?? undefined,
    )
    if (isCleared(summary)) return { sent: false, reason: 'cleared' }
    if (summary.state === 'not_required') return { sent: false, reason: 'not_required' }
    if (nextStepIsStellrs(summary, eventDate ? new Date(eventDate) : now)) return { sent: false, reason: 'staff_review' }

    if ((await sentNoticeKeys(db, [memberId])).has(noticeKey(memberId, eventSlug, reason))) {
      return { sent: false, reason: 'already_sent' }
    }

    const daysAway = eventDate ? daysUntil(eventDate, todayMountain(now)) : null
    const email = clearanceNoticeEmail({
      firstName: (member.first_name as string | null) ?? null,
      eventTitle,
      eventDate,
      reason,
      daysAway,
      checkStarted: summary.check?.status === 'invited' || summary.check?.status === 'in_progress',
      url: `${AUTH_APP_URL}${CLEARANCE_PATH}`,
    })

    // Email first: if it throws, nothing is recorded and the next call retries
    // cleanly, without a second in-app notification.
    let emailed = false
    if (member.email) {
      await sendEmail({ to: member.email as string, ...email })
      emailed = true
    }

    const { error: inAppError } = await db.from('community_notifications').insert({
      recipient_member_id: memberId,
      actor_member_id: null,
      type: 'action',
      reference_type: 'compliance',
      reference_id: memberId,
      body:
        reason === 'reminder'
          ? `${eventTitle} is ${awayPhrase(daysAway)}. Add your teaching license so you're cleared to take part.`
          : `Before ${eventTitle}: add your teaching license so you're cleared to work with students.`,
    })
    if (inAppError) console.error('[compliance-notify] in-app notification failed:', inAppError)
    const inApp = !inAppError
    if (!emailed && !inApp) {
      return { sent: false, reason: 'error', error: 'No email address on file and the in-app notification failed' }
    }

    await logActivity(
      {
        memberId,
        category: 'compliance',
        action: NOTICE_ACTION,
        summary:
          reason === 'reminder'
            ? `Clearance reminder sent for ${eventTitle}`
            : `Clearance notice sent for ${eventTitle} (registration)`,
        metadata: { eventSlug, eventTitle, eventDate, reason, emailed, inApp },
        actorType: 'system',
      },
      db,
    )
    return { sent: true, emailed, inApp }
  } catch (err) {
    console.error('[compliance-notify] notice failed:', { memberId, eventSlug, reason }, err)
    return { sent: false, reason: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

export interface ReminderRunResult {
  dryRun: boolean
  /** Distinct events with a live (non-withdrawn) registration. */
  events: number
  /** No date from Sanity (unset in CI, or not yet scheduled): skipped. */
  eventsUndated: number
  /** 0–14 days away. */
  eventsInWindow: number
  /** Adults in those events not cleared — one per member per event. */
  uncleared: number
  /** Not cleared, but the next step is Stellr's (see 'staff_review'). */
  withStellr: number
  alreadySent: number
  /** Uncleared and not yet reminded: what this run sends, or would in a dry run. */
  due: number
  sent: number
  /** Re-checked at send time and no longer needed (e.g. cleared since). */
  skipped: number
  failed: number
  /** Over this run's cap or time budget; the next run picks them up. */
  deferred: number
  errors: { where: string; error: string }[]
}

type ReminderEvent = { slug: string; title: string; date: string; daysAway: number; registrationIds: string[] }
type Participant = { member_id: string; event_role: string; date_of_birth: string | null }

/**
 * The 14-days-out reminder sweep, run daily by the background-sync cron. For
 * each event 0–14 days away, every participant in an event-facing role
 * (BC_REQUIRED_ROLES) whose member is not cleared gets
 * notifyClearanceRequired(..., reason: 'reminder') — once, thanks to its ledger.
 * Soonest events go first, so the per-run cap defers the furthest-off ones.
 */
export async function remindUnclearedAdults(
  db: SupabaseClient,
  opts: { now?: Date; dryRun?: boolean; maxSends?: number; canContinue?: () => boolean } = {},
): Promise<ReminderRunResult> {
  const now = opts.now ?? new Date()
  const dryRun = opts.dryRun ?? false
  const maxSends = opts.maxSends ?? REMINDER_MAX_PER_RUN
  const canContinue = opts.canContinue ?? (() => true)
  const today = todayMountain(now)
  const result: ReminderRunResult = {
    dryRun, events: 0, eventsUndated: 0, eventsInWindow: 0, uncleared: 0, withStellr: 0,
    alreadySent: 0, due: 0, sent: 0, skipped: 0, failed: 0, deferred: 0, errors: [],
  }

  // 1. Live registrations, grouped by event.
  const since = new Date(now.getTime() - REGISTRATION_LOOKBACK_DAYS * 86_400_000).toISOString()
  const bySlug = new Map<string, { title: string | null; ids: string[] }>()
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from('registrations')
      .select('id, event_slug, event_title')
      .neq('status', 'withdrawn')
      .gte('created_at', since)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`registrations: ${error.message}`)
    const rows = (data ?? []) as { id: string; event_slug: string | null; event_title: string | null }[]
    for (const r of rows) {
      if (!r.event_slug) continue
      const entry = bySlug.get(r.event_slug) ?? { title: r.event_title, ids: [] }
      entry.ids.push(r.id)
      bySlug.set(r.event_slug, entry)
    }
    if (rows.length < PAGE_SIZE) break
  }
  result.events = bySlug.size

  // 2. Which of those events are 0–14 days away. Dates come from Sanity.
  const dated = await Promise.all(
    [...bySlug].map(async ([slug, regs]) => {
      const e = (await getEventBySlug(slug).catch(() => null)) as { title?: string | null; date?: string | null } | null
      return { slug, title: e?.title || regs.title || slug, date: calendarDate(e?.date), registrationIds: regs.ids }
    }),
  )
  const inWindow: ReminderEvent[] = []
  for (const e of dated) {
    if (!e.date) {
      result.eventsUndated++
      continue
    }
    const daysAway = daysUntil(e.date, today)
    if (daysAway >= 0 && daysAway <= REMINDER_WINDOW_DAYS) inWindow.push({ ...e, date: e.date, daysAway })
  }
  inWindow.sort((a, b) => a.daysAway - b.daysAway)
  result.eventsInWindow = inWindow.length

  // 3. Their participants in event-facing roles who have a member account.
  const participantsByEvent = new Map<string, Participant[]>()
  for (const ev of inWindow) {
    const seen = new Map<string, Participant>()
    for (let i = 0; i < ev.registrationIds.length; i += ID_CHUNK) {
      const { data, error } = await db
        .from('participants')
        .select('member_id, event_role, date_of_birth')
        .in('registration_id', ev.registrationIds.slice(i, i + ID_CHUNK))
        .in('event_role', [...BC_REQUIRED_ROLES])
        .not('member_id', 'is', null)
      if (error) {
        result.errors.push({ where: `participants:${ev.slug}`, error: error.message })
        continue
      }
      for (const p of (data ?? []) as Participant[]) if (!seen.has(p.member_id)) seen.set(p.member_id, p)
    }
    participantsByEvent.set(ev.slug, [...seen.values()])
  }

  // 4. Who of them is not cleared as of their event's date.
  const memberIds = [...new Set([...participantsByEvent.values()].flat().map((p) => p.member_id))]
  if (memberIds.length === 0) return result
  const { byId } = await loadComplianceRecordsForMembers(db, memberIds, [])
  if (byId.size === 0) {
    // Every participant has a member row (the FK), so an empty answer is a failed read.
    result.errors.push({ where: 'compliance', error: 'compliance records could not be read' })
    return result
  }

  const due: { ev: ReminderEvent; memberId: string }[] = []
  for (const ev of inWindow) {
    for (const p of participantsByEvent.get(ev.slug) ?? []) {
      const rec = byId.get(p.member_id)
      if (!rec) continue
      const summary = deriveCompliance(rec.license, rec.checks, p.event_role, p.date_of_birth ?? rec.dateOfBirth, ev.date)
      if (isCleared(summary) || summary.state === 'not_required') continue
      result.uncleared++
      if (nextStepIsStellrs(summary, new Date(ev.date))) {
        result.withStellr++
        continue
      }
      due.push({ ev, memberId: p.member_id })
    }
  }

  // 5. Skip anyone already reminded for that event; send to the rest, capped.
  const sentKeys = await sentNoticeKeys(db, due.map((d) => d.memberId))
  for (const { ev, memberId } of due) {
    if (sentKeys.has(noticeKey(memberId, ev.slug, 'reminder'))) {
      result.alreadySent++
      continue
    }
    result.due++
    if (dryRun) continue
    if (result.sent >= maxSends || !canContinue()) {
      result.deferred++
      continue
    }
    const out = await notifyClearanceRequired(
      db,
      { memberId, eventSlug: ev.slug, eventTitle: ev.title, eventDate: ev.date, reason: 'reminder' },
      { now },
    )
    if (out.sent) result.sent++
    else if (out.reason === 'error') {
      result.failed++
      result.errors.push({ where: `notice:${ev.slug}:${memberId}`, error: out.error ?? 'unknown error' })
    } else result.skipped++
  }

  return result
}
