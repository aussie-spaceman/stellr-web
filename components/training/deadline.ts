// Deadline colour ramp + copy, shared by My training rows and the course detail
// chip. overdue / due today / <=3 days = danger; <=7 days = warning; else neutral.

export interface DeadlineInfo {
  text: string
  color: string
  /** True when red (overdue / due today / within 3 days). */
  urgent: boolean
  daysLeft: number
}

const DANGER = '#C0392B'
const WARNING = '#B07A1E'
const NEUTRAL = '#5A6178'
const DAY = 24 * 60 * 60_000

export function deadlineInfo(dueAt: string | null | undefined): DeadlineInfo | null {
  if (!dueAt) return null
  const due = new Date(dueAt).getTime()
  if (Number.isNaN(due)) return null
  const diff = due - Date.now()
  const daysLeft = Math.ceil(diff / DAY)

  if (diff < 0) return { text: 'Overdue', color: DANGER, urgent: true, daysLeft }
  if (daysLeft === 0) return { text: 'Due today', color: DANGER, urgent: true, daysLeft }
  const text = `Due in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`
  if (daysLeft <= 3) return { text, color: DANGER, urgent: true, daysLeft }
  if (daysLeft <= 7) return { text, color: WARNING, urgent: false, daysLeft }
  return { text, color: NEUTRAL, urgent: false, daysLeft }
}
