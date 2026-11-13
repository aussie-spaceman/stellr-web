import { listAllCoachingSessions } from '@/lib/coaching'
import { AdminCoachingNav } from '@/components/admin/coaching/AdminCoachingNav'
import { CoachingSessionsCalendar } from '@/components/admin/coaching/CoachingSessionsCalendar'
import { authz } from '@/lib/authz'

export const metadata = { title: 'Admin · Coaching sessions calendar' }

export default async function CoachingCalendarPage() {
  await authz.page.requireCapability('portal:read', { route: '/admin/academy/coaching/calendar' })
  const sessions = await listAllCoachingSessions()
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-8">
      <AdminCoachingNav />
      <div className="min-w-0 flex-1 space-y-4">
        <h1 className="font-display text-[28px] font-bold text-ink">Sessions calendar</h1>
        <CoachingSessionsCalendar sessions={sessions} />
      </div>
    </div>
  )
}
