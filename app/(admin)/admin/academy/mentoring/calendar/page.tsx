import { listAllMentoringSessions } from '@/lib/mentoring'
import { AdminMentoringNav } from '@/components/admin/mentoring/AdminMentoringNav'
import { SessionsCalendar } from '@/components/admin/mentoring/SessionsCalendar'
import { requireAdminPage } from '@/lib/admin-auth'

export const metadata = { title: 'Admin · Sessions calendar' }

export default async function SessionsCalendarPage() {
  await requireAdminPage()
  const sessions = await listAllMentoringSessions()
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-8">
      <AdminMentoringNav />
      <div className="min-w-0 flex-1 space-y-4">
        <h1 className="font-display text-[28px] font-bold text-ink">Sessions calendar</h1>
        <SessionsCalendar sessions={sessions} />
      </div>
    </div>
  )
}
