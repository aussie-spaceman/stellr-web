'use client'

import { useMemo } from 'react'
import type { CalendarSession } from '@/lib/mentoring'
import { MonthCalendar, type CalendarEntry } from '@/components/admin/MonthCalendar'

// Mentoring sessions, one colour per cohort.
export function SessionsCalendar({ sessions }: { sessions: CalendarSession[] }) {
  const entries = useMemo<CalendarEntry[]>(
    () =>
      sessions.map((s) => ({
        id: s.id,
        start: s.start,
        href: `/admin/academy/mentoring/${s.cohortId}`,
        groupKey: s.cohortId,
        groupLabel: s.cohortName,
        title: s.title,
      })),
    [sessions]
  )
  return <MonthCalendar entries={entries} emptyLabel="No mentoring sessions this month." />
}
