'use client'

import { useMemo } from 'react'
import type { CoachingCalendarSession } from '@/lib/coaching'
import { MonthCalendar, type CalendarEntry } from '@/components/admin/MonthCalendar'

// Coaching sessions, one colour per member.
export function CoachingSessionsCalendar({ sessions }: { sessions: CoachingCalendarSession[] }) {
  const entries = useMemo<CalendarEntry[]>(
    () =>
      sessions.map((s) => ({
        id: s.id,
        start: s.start,
        href: `/admin/academy/coaching/${s.workshopId}`,
        groupKey: s.memberName ?? s.workshopId,
        groupLabel: s.memberName ?? s.workshopName,
        title: s.title,
      })),
    [sessions]
  )
  return <MonthCalendar entries={entries} emptyLabel="No coaching sessions this month." />
}
