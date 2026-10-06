/**
 * When a survey opens and closes (D3, set by David 2 Oct 2026), and when each
 * reminder is due (P1). Pure functions over plain values so the rules can be
 * tested with a mocked clock; lib/survey/distributions.ts applies them.
 *
 *   - Goes live at 00:00 event-local on the event's last day.
 *   - An admin or the event's manager may bring that forward (or open now),
 *     never push it later than the event date.
 *   - Closes 30 days after the actual go-live (the database enforces this too).
 *   - An event-date change reschedules an automatic go-live; a manual one is
 *     kept and flagged for the admin.
 */
import { zonedTimeToUtc } from './timezone'

export const SURVEY_OPEN_DAYS = 30
const DAY = 24 * 60 * 60 * 1000

export type DistributionStatus = 'scheduled' | 'open' | 'paused' | 'closed'
export type ScheduleFlag = 'event_date_changed' | 'event_cancelled' | null

export interface ScheduleEvent {
  date?: string | null
  endDate?: string | null
  status?: string | null
}

/** The event's last day (YYYY-MM-DD), or null for an undated event. */
export function eventLastDay(e: ScheduleEvent): string | null {
  const last = e.endDate || e.date
  return last && /^\d{4}-\d{2}-\d{2}$/.test(last) ? last : null
}

export function autoOpensAt(lastDay: string, tz: string): Date {
  return zonedTimeToUtc(lastDay, tz, 0, 0)
}

export function closesAtFor(opensAt: Date): Date {
  return new Date(opensAt.getTime() + SURVEY_OPEN_DAYS * DAY)
}

export type ManualCheck = { ok: true; opensAt: Date } | { ok: false; error: 'later_than_event' | 'in_past' | 'invalid' }

/**
 * An earlier go-live chosen by an admin/event manager. "Send live now" passes
 * `now`. A time in the past (beyond a minute's slack) is refused rather than
 * silently shortening the 30-day window.
 */
export function checkManualOpensAt(requested: Date, autoOpens: Date, now: Date): ManualCheck {
  if (Number.isNaN(requested.getTime())) return { ok: false, error: 'invalid' }
  if (requested.getTime() > autoOpens.getTime()) return { ok: false, error: 'later_than_event' }
  if (requested.getTime() < now.getTime() - 60_000) return { ok: false, error: 'in_past' }
  return { ok: true, opensAt: requested }
}

/**
 * An event that ended without a survey (it ran before a definition was
 * published) can still have one opened by hand, for a full 30 days from then,
 * while its automatic window would not yet have closed. Returns that automatic
 * close, or null when it is too late, or too early (before 00:00 on the last
 * day, when the normal schedule applies).
 */
export function lateOpenDeadline(lastDay: string, tz: string, now: Date): Date | null {
  const auto = autoOpensAt(lastDay, tz)
  const autoClose = closesAtFor(auto)
  return auto.getTime() <= now.getTime() && now.getTime() < autoClose.getTime() ? autoClose : null
}

export interface ScheduleState {
  status: DistributionStatus
  opens_at: string
  closes_at: string
  opens_at_source: 'auto' | 'manual'
  event_date: string
  event_time_zone: string
  schedule_flag: ScheduleFlag
}

/**
 * What the distribution should become given the event as Sanity now has it.
 * Returns only the fields that change (empty = nothing to do).
 */
export function reconcileWithEvent(
  d: ScheduleState,
  e: { lastDay: string | null; timeZone: string; cancelled: boolean },
): Partial<ScheduleState> {
  const patch: Partial<ScheduleState> = {}
  if (e.cancelled) {
    if (d.status === 'scheduled') patch.status = 'paused'
    if (d.schedule_flag !== 'event_cancelled' && d.status !== 'closed') patch.schedule_flag = 'event_cancelled'
    return patch
  }
  if (d.schedule_flag === 'event_cancelled') patch.schedule_flag = null
  if (!e.lastDay) return patch
  const changed = e.lastDay !== d.event_date || e.timeZone !== d.event_time_zone
  if (!changed) return patch
  patch.event_date = e.lastDay
  patch.event_time_zone = e.timeZone
  if (d.status !== 'scheduled') return patch
  if (d.opens_at_source === 'auto') {
    patch.opens_at = autoOpensAt(e.lastDay, e.timeZone).toISOString()
  } else {
    patch.schedule_flag = 'event_date_changed'
  }
  return patch
}

/** Status after applying the clock: a due scheduled survey is open, an expired open one closed. */
export function effectiveStatus(d: Pick<ScheduleState, 'status' | 'opens_at' | 'closes_at'>, now: Date): DistributionStatus {
  if (d.status === 'scheduled' && new Date(d.opens_at) <= now) {
    return new Date(d.closes_at) <= now ? 'closed' : 'open'
  }
  if (d.status === 'open' && new Date(d.closes_at) <= now) return 'closed'
  return d.status
}

// ── Reminder cadence (P1) ────────────────────────────────────────────────────

export type ReminderKind = 'nudge' | 'closing' | 'resume'

export interface CadenceInvitation {
  status: string
  sent_at: string | null
  reminder_count: number
  resume_reminder_count: number
  last_reminder_at: string | null
  reminders_opted_out_at: string | null
}

export interface CadenceDistribution {
  status: DistributionStatus
  opens_at: string
  closes_at: string
}

/** Days apart any two reminders to the same person must be. */
const MIN_GAP = 2 * DAY

/**
 * The reminder due for one invitation now, or null.
 *
 * Not started (sent/opened): day 3 and day 7 after go-live (or after their own
 * invitation, if invited late), then "closing in 3 days" 3 days before close.
 * At most 3; a late invitee who is already near the close gets only the closing one.
 * Started but not submitted: 48 h after the last save, at most 2.
 * Never after close, never once opted out, submitted or bounced.
 */
export function dueReminder(
  inv: CadenceInvitation,
  dist: CadenceDistribution,
  now: Date,
  lastSavedAt: string | null = null,
): ReminderKind | null {
  if (effectiveStatus(dist, now) !== 'open') return null
  const closes = new Date(dist.closes_at).getTime()
  if (now.getTime() >= closes) return null
  if (inv.reminders_opted_out_at || !inv.sent_at) return null
  const t = now.getTime()
  const sent = new Date(inv.sent_at).getTime()
  if (t - sent < DAY) return null
  if (inv.last_reminder_at && t - new Date(inv.last_reminder_at).getTime() < MIN_GAP) return null

  if (inv.status === 'started') {
    if (inv.resume_reminder_count >= 2 || !lastSavedAt) return null
    const since = Math.max(new Date(lastSavedAt).getTime(), inv.last_reminder_at ? new Date(inv.last_reminder_at).getTime() : 0)
    return t - since >= 2 * DAY ? 'resume' : null
  }

  if (inv.status !== 'sent' && inv.status !== 'opened') return null
  if (inv.reminder_count >= 3) return null
  if (t >= closes - 3 * DAY) return 'closing'
  const base = Math.max(new Date(dist.opens_at).getTime(), sent)
  if (inv.reminder_count === 0 && t >= base + 3 * DAY) return 'nudge'
  if (inv.reminder_count === 1 && t >= base + 7 * DAY) return 'nudge'
  return null
}
