import { listAllMentoringSessions } from '@/lib/mentoring'
import { AdminMentoringNav } from '@/components/admin/mentoring/AdminMentoringNav'
import { SessionsCalendar } from '@/components/admin/mentoring/SessionsCalendar'

export const metadata = { title: 'Admin · Sessions calendar' }

export default async function SessionsCalendarPage() {
  const sessions = await listAllMentoringSessions()
  return (
    <div className="flex gap-8">
      <AdminMentoringNav />
      <div className="min-w-0 flex-1 space-y-4">
        <h1 className="font-display text-[28px] font-bold tracking-[-0.02em] text-ink">Sessions calendar</h1>
        <SessionsCalendar sessions={sessions} />
      </div>
    </div>
  )
}
