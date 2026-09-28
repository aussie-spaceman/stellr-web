// Date maths for "send N days before the event". Pure — imported by the
// client panel, so it must not import render.ts (which reaches server code).

/** Whole days from `today` to the event date (negative once it has passed). */
export function daysUntil(eventDate: string, today: string): number {
  const a = Date.parse(`${eventDate.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${today}T00:00:00Z`)
  return Math.round((a - b) / 86_400_000)
}

export type ScheduleDecision = 'wait' | 'send' | 'skip'

/**
 * `today` and `eventDate` are calendar dates (YYYY-MM-DD, Mountain time).
 * Due from the day N days out through the event day itself, so a day the cron
 * missed still sends late rather than never; once the event has passed, an
 * unsent reminder is pointless and is skipped.
 */
export function scheduleDecision(eventDate: string | null | undefined, daysBefore: number, today: string): ScheduleDecision {
  if (!eventDate) return 'wait'
  const left = daysUntil(eventDate, today)
  if (left < 0) return 'skip'
  return left <= daysBefore ? 'send' : 'wait'
}

/** The calendar date a scheduled email goes out, for display. */
export function scheduledSendDate(eventDate: string, daysBefore: number): string {
  const d = new Date(`${eventDate.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - daysBefore)
  return d.toISOString().slice(0, 10)
}
