import { listRequests, listCoachOptions, countPendingRequests } from '@/lib/coaching-requests'
import { AdminCoachingNav } from '@/components/admin/coaching/AdminCoachingNav'
import { CoachingRequestQueue } from '@/components/admin/coaching/CoachingRequestQueue'

export const metadata = { title: 'Admin · Coaching requests' }

export default async function AdminCoachingRequestsPage() {
  const [requests, coaches, pending] = await Promise.all([
    listRequests(),
    listCoachOptions(),
    countPendingRequests(),
  ])

  return (
    <div className="flex gap-8">
      <AdminCoachingNav />
      <div className="min-w-0 flex-1 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-[28px] font-bold tracking-[-0.02em] text-ink">Coaching requests</h1>
          <span className="inline-flex items-center gap-2 rounded-pill bg-[#FDEFD6] px-3.5 py-1.5 text-[13px] font-bold text-brand-gold-ink">
            {pending} pending
          </span>
        </div>
        <p className="max-w-2xl text-[14.5px] text-content-secondary">
          Members request coaching from the Academy. Match each one with a coach and set their eligibility —
          the member then books a slot (paying only when their eligibility is <em>paid</em>).
        </p>
        <CoachingRequestQueue requests={requests} coaches={coaches} />
      </div>
    </div>
  )
}
