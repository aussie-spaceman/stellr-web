import Link from 'next/link'
import { Plus } from 'lucide-react'
import { listAllWorkshops, getAdminWorkshopStats } from '@/lib/coaching'
import { AdminCoachingNav } from '@/components/admin/coaching/AdminCoachingNav'

export const metadata = { title: 'Admin · Coaching workshops' }

export default async function AdminWorkshopsPage() {
  const [workshops, stats] = await Promise.all([listAllWorkshops(), getAdminWorkshopStats()])

  return (
    <div className="flex gap-8">
      <AdminCoachingNav />
      <div className="min-w-0 flex-1 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-[28px] font-bold tracking-[-0.02em] text-ink">Coaching workshops</h1>
          <Link href="/admin/academy/coaching/new" className="inline-flex items-center gap-2 rounded-[9px] bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-deep">
            <Plus className="h-4 w-4" /> New workshop
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <Stat label="Active workshops" value={stats.activeWorkshops} />
          <Stat label="Coaches" value={stats.coaches} />
          <Stat label="Sessions this week" value={stats.sessionsThisWeek} />
          <Stat label="Pending invites" value={stats.pendingInvites} tone="amber" />
        </div>

        <div className="overflow-hidden rounded-card border border-line bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-light text-left text-[12px] font-semibold uppercase tracking-[0.05em] text-content-faint">
                <th className="px-5 py-3">Workshop</th>
                <th className="px-5 py-3">Coach</th>
                <th className="px-5 py-3">Member</th>
                <th className="px-5 py-3">Progress</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {workshops.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-content-muted">No workshops yet.</td></tr>
              ) : (
                workshops.map((w) => (
                  <tr key={w.id} className="border-b border-line-light last:border-0 hover:bg-surface">
                    <td className="px-5 py-3">
                      <Link href={`/admin/academy/coaching/${w.id}`} className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] font-display text-sm font-bold text-white" style={{ background: 'linear-gradient(150deg,#7C5CFC,#5B3FE0)' }}>{w.name.charAt(0)}</span>
                        <span>
                          <span className="block font-medium text-ink">{w.name}</span>
                          <span className="block text-[12px] text-content-muted">Session {w.heldSessions} of {w.plannedSessions}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-content-secondary">{w.coachName ?? '—'}</td>
                    <td className="px-5 py-3 text-content-secondary">
                      {w.memberName ?? '—'}
                      {w.memberStatus === 'invited' && <span className="ml-1.5 rounded-pill bg-pathway-amber-bg px-2 py-0.5 text-[10px] font-bold text-[#C2722A]">INVITED</span>}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex w-32 items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-pill bg-[#EEF0F7]"><div className="h-full rounded-pill bg-space-violet" style={{ width: `${w.progressPct}%` }} /></div>
                        <span className="text-[12px] text-content-muted">{w.progressPct}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`rounded-pill px-2.5 py-0.5 text-[11px] font-semibold ${w.lifecycle === 'active' ? 'bg-enviro-green-bg text-enviro-green-text' : 'bg-surface text-content-muted'}`}>
                        {w.lifecycle === 'active' ? 'Active' : 'Archived'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'amber' }) {
  return (
    <div className="rounded-card border border-line bg-white p-4">
      <p className="text-[12px] font-semibold uppercase tracking-[0.05em] text-content-faint">{label}</p>
      <p className={`mt-1 font-display text-[26px] font-bold ${tone === 'amber' && value > 0 ? 'text-pathway-amber' : 'text-ink'}`}>{value}</p>
    </div>
  )
}
