import Link from 'next/link'
import { Plus } from 'lucide-react'
import { listAllCohorts, getAdminCohortStats } from '@/lib/mentoring'
import { themeTile } from '@/lib/mentoring-format'
import { AdminMentoringNav } from '@/components/admin/mentoring/AdminMentoringNav'

export const metadata = { title: 'Admin · Mentoring cohorts' }

export default async function AdminCohortsPage() {
  const [cohorts, stats] = await Promise.all([listAllCohorts(), getAdminCohortStats()])

  return (
    <div className="flex gap-8">
      <AdminMentoringNav />
      <div className="min-w-0 flex-1 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-[28px] font-bold tracking-[-0.02em] text-ink">Cohorts</h1>
          <Link href="/admin/community/cohorts/new" className="inline-flex items-center gap-2 rounded-[9px] bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-deep">
            <Plus className="h-4 w-4" /> New cohort
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <Stat label="Active cohorts" value={stats.activeCohorts} />
          <Stat label="Members enrolled" value={stats.membersEnrolled} />
          <Stat label="Sessions this week" value={stats.sessionsThisWeek} />
          <Stat label="Pending invites" value={stats.pendingInvites} tone="amber" />
        </div>

        <div className="overflow-hidden rounded-card border border-line bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-light text-left text-[12px] font-semibold uppercase tracking-[0.05em] text-content-faint">
                <th className="px-5 py-3">Cohort</th>
                <th className="px-5 py-3">Mentor</th>
                <th className="px-5 py-3">Members</th>
                <th className="px-5 py-3">Progress</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {cohorts.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-content-muted">No cohorts yet.</td></tr>
              ) : (
                cohorts.map((c) => {
                  const tile = themeTile(c.theme)
                  return (
                    <tr key={c.id} className="border-b border-line-light last:border-0 hover:bg-surface">
                      <td className="px-5 py-3">
                        <Link href={`/admin/community/cohorts/${c.id}`} className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] font-display text-sm font-bold text-white" style={{ background: tile.gradient }}>{c.name.charAt(0)}</span>
                          <span>
                            <span className="block font-medium text-ink">{c.name}</span>
                            <span className="block text-[12px] text-content-muted">Session {c.heldSessions} of {c.plannedSessions}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-content-secondary">{c.mentorName ?? '—'}</td>
                      <td className="px-5 py-3 text-content-secondary">{c.memberCount}</td>
                      <td className="px-5 py-3">
                        <div className="flex w-32 items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-pill bg-[#EEF0F7]"><div className="h-full rounded-pill bg-space-violet" style={{ width: `${c.progressPct}%` }} /></div>
                          <span className="text-[12px] text-content-muted">{c.progressPct}%</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`rounded-pill px-2.5 py-0.5 text-[11px] font-semibold ${c.lifecycle === 'active' ? 'bg-enviro-green-bg text-enviro-green-text' : 'bg-surface text-content-muted'}`}>
                          {c.lifecycle === 'active' ? 'Active' : 'Archived'}
                        </span>
                      </td>
                    </tr>
                  )
                })
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
