import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Calendar, Flag, CheckSquare, ChevronRight } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { getHostCaps } from '@/lib/sessions'
import { getCoachDashboardStats, listMemberWorkshops } from '@/lib/coaching'
import { formatSessionTime } from '@/lib/mentoring-format'

export const metadata = { title: 'Coach workspace · Your coaching workshops' }

export default async function CoachDashboardPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')
  const caps = await getHostCaps(member.id)
  if (!member.isAdmin && !caps.canCoach) redirect('/community/coaching')

  const [stats, cards] = await Promise.all([getCoachDashboardStats(member.id), listMemberWorkshops(member)])
  const mine = cards.filter((c) => c.isCoach)
  const active = mine.filter((c) => c.lifecycle === 'active')
  const completed = mine.filter((c) => c.lifecycle === 'archived')
  const next = stats.nextSession ? formatSessionTime(stats.nextSession.start, stats.nextSession.end, stats.nextSession.timezone) : null

  return (
    <div className="mx-auto max-w-content space-y-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-subheading text-[13px] font-semibold uppercase tracking-[0.13em] text-space-violet">
            Coach workspace
          </p>
          <h1 className="mt-1 font-display text-[34px] font-bold leading-tight tracking-[-0.02em] text-ink">
            Your coaching workshops
          </h1>
        </div>
        <Link href="/community/coaching" className="inline-flex shrink-0 items-center gap-2 rounded-[9px] border border-line px-4 py-2.5 text-sm font-semibold text-content-secondary hover:border-space-violet hover:text-space-violet">
          ← Back to coaching
        </Link>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={<Calendar className="h-4 w-4" />} label="Next session" value={next ? `${next.dateShort} · ${next.timeLine}` : 'None scheduled'} tone="violet" />
        <StatCard icon={<Flag className="h-4 w-4" />} label="Flagged messages" value={stats.flaggedCount > 0 ? `${stats.flaggedCount} to review` : 'All clear'} tone={stats.flaggedCount > 0 ? 'amber' : 'plain'} />
        <StatCard icon={<CheckSquare className="h-4 w-4" />} label="Actions due" value={`${stats.actionsDue} outstanding`} tone="plain" />
      </div>

      <section className="space-y-3">
        {active.length === 0 ? (
          <div className="rounded-card border border-dashed border-line bg-white py-12 text-center">
            <p className="text-sm text-content-muted">No coaching workshops assigned to you yet. An admin assigns coaches to workshops.</p>
          </div>
        ) : (
          active.map((c) => {
            const cn = c.nextSessionStart ? formatSessionTime(c.nextSessionStart, c.nextSessionEnd, c.timezone) : null
            const needsScheduling = !cn && c.progressPct === 0
            return (
              <Link
                key={c.id}
                href={`/community/coaching/coach/${c.id}`}
                className={`group flex items-center gap-4 rounded-card border bg-white p-5 transition-all hover:-translate-y-px hover:shadow-card-lift ${needsScheduling ? 'border-pathway-amber/40' : 'border-line'}`}
                style={needsScheduling ? { background: 'linear-gradient(100deg,#FBEFDD33,#fff 70%)' } : undefined}
              >
                <div className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-[13px] font-display text-lg font-bold text-white" style={{ background: 'linear-gradient(150deg,#7C5CFC,#5B3FE0)' }}>
                  {c.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-[20px] font-bold text-ink">{c.name}</h3>
                    {needsScheduling && (
                      <span className="rounded-pill bg-pathway-amber-bg px-2.5 py-0.5 text-[11px] font-bold text-[#C2722A]">NEEDS SCHEDULING</span>
                    )}
                  </div>
                  <p className="mt-1 text-[13.5px] text-content-secondary">
                    {c.memberName ?? 'Member'} · 1-on-1 · {c.plannedSessions} sessions
                    {cn && <> · next {cn.dateShort}</>}
                    {c.actionsDue > 0 && <> · {c.actionsDue} actions due</>}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-content-faint group-hover:text-primary" />
              </Link>
            )
          })
        )}
      </section>

      {completed.length > 0 && (
        <section>
          <h2 className="mb-2 font-subheading text-[12px] font-semibold uppercase tracking-[0.1em] text-content-faint">Completed</h2>
          <ul className="divide-y divide-line-light rounded-card border border-line bg-white">
            {completed.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-5 py-3.5">
                <span className="text-sm font-medium text-content-secondary">{c.name}</span>
                <Link href={`/community/coaching/coach/${c.id}`} className="text-[13px] font-medium text-content-muted hover:text-primary">Manage →</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function StatCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: 'violet' | 'amber' | 'plain' }) {
  const toneCls = tone === 'violet' ? 'text-space-violet' : tone === 'amber' ? 'text-pathway-amber' : 'text-content-secondary'
  return (
    <div className="rounded-card border border-line bg-white p-5">
      <p className={`flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] ${toneCls}`}>{icon} {label}</p>
      <p className="mt-2 font-display text-[18px] font-bold text-ink">{value}</p>
    </div>
  )
}
