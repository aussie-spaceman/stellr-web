import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus, Calendar, Flag, CheckSquare, ChevronRight } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { getHostCaps } from '@/lib/sessions'
import { getMentorDashboardStats, listMenteeCohortCards } from '@/lib/mentoring'
import { formatSessionTime, themeTile } from '@/lib/mentoring-format'

export const metadata = { title: 'Mentor workspace · Your cohorts' }

export default async function MentorDashboardPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')
  const caps = await getHostCaps(member.id)
  if (!member.isAdmin && !caps.canMentor) redirect('/community/mentoring')

  const [stats, cards] = await Promise.all([getMentorDashboardStats(member.id), listMenteeCohortCards(member)])
  const mine = cards.filter((c) => c.isMentor)
  const active = mine.filter((c) => c.lifecycle === 'active')
  const completed = mine.filter((c) => c.lifecycle === 'archived')
  const next = stats.nextSession ? formatSessionTime(stats.nextSession.start, stats.nextSession.end, stats.nextSession.timezone) : null

  return (
    <div className="mx-auto max-w-content space-y-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-subheading text-[13px] font-semibold uppercase tracking-[0.13em] text-space-violet">
            Mentor workspace
          </p>
          <h1 className="mt-1 font-display text-[34px] font-bold leading-tight tracking-[-0.02em] text-ink">Your cohorts</h1>
        </div>
        <Link
          href="/community/mentoring/new"
          className="inline-flex shrink-0 items-center gap-2 rounded-[9px] bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-deep"
        >
          <Plus className="h-4 w-4" /> New cohort
        </Link>
      </header>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={<Calendar className="h-4 w-4" />}
          label="Next session"
          value={next ? `${next.dateShort} · ${next.timeLine}` : 'None scheduled'}
          tone="violet"
        />
        <StatCard
          icon={<Flag className="h-4 w-4" />}
          label="Flagged messages"
          value={stats.flaggedCount > 0 ? `${stats.flaggedCount} to review` : 'All clear'}
          tone={stats.flaggedCount > 0 ? 'amber' : 'plain'}
        />
        <StatCard
          icon={<CheckSquare className="h-4 w-4" />}
          label="Actions due"
          value={`${stats.actionsDue} outstanding`}
          tone="plain"
        />
      </div>

      {/* Active cohorts */}
      <section className="space-y-3">
        {active.length === 0 ? (
          <div className="rounded-card border border-dashed border-line bg-white py-12 text-center">
            <p className="text-sm text-content-muted">
              You haven&apos;t created a cohort yet.{' '}
              <Link href="/community/mentoring/new" className="font-semibold text-primary hover:underline">Create your first cohort →</Link>
            </p>
          </div>
        ) : (
          active.map((c) => {
            const tile = themeTile(c.theme)
            const cn = c.nextSessionStart ? formatSessionTime(c.nextSessionStart, c.nextSessionEnd, c.timezone) : null
            return (
              <Link
                key={c.id}
                href={`/community/mentoring/${c.id}/manage`}
                className="group flex items-center gap-4 rounded-card border border-line bg-white p-5 transition-all hover:-translate-y-px hover:shadow-card-lift"
              >
                <div className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-[13px] font-display text-lg font-bold text-white" style={{ background: tile.gradient }}>
                  {c.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-display text-[20px] font-bold text-ink">{c.name}</h3>
                    <span className={`rounded-pill px-2.5 py-0.5 text-[11px] font-bold tracking-[0.04em] ${tile.chip}`}>{tile.label}</span>
                  </div>
                  <p className="mt-1 text-[13.5px] text-content-secondary">
                    {c.memberCount} member{c.memberCount === 1 ? '' : 's'} · {c.plannedSessions} sessions
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
                <Link href={`/community/mentoring/${c.id}/manage`} className="text-[13px] font-medium text-content-muted hover:text-primary">Manage →</Link>
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
      <p className={`flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] ${toneCls}`}>
        {icon} {label}
      </p>
      <p className="mt-2 font-display text-[18px] font-bold text-ink">{value}</p>
    </div>
  )
}
