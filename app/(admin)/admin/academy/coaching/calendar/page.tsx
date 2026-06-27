import { listAllCoachingSessions } from '@/lib/coaching'
import { AdminCoachingNav } from '@/components/admin/coaching/AdminCoachingNav'
import { CoachingSessionsCalendar } from '@/components/admin/coaching/CoachingSessionsCalendar'

export const metadata = { title: 'Admin · Coaching sessions calendar' }

export default async function CoachingCalendarPage() {
  const sessions = await listAllCoachingSessions()
  return (
    <div className="flex gap-8">
      <AdminCoachingNav />
      <div className="min-w-0 flex-1 space-y-4">
        <h1 className="font-display text-[28px] font-bold tracking-[-0.02em] text-ink">Sessions calendar</h1>
        <CoachingSessionsCalendar sessions={sessions} />
      </div>
    </div>
  )
}
