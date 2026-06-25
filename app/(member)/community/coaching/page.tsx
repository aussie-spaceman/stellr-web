import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Calendar, CalendarPlus } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { getHostCaps } from '@/lib/sessions'
import {
  getCoachingAllowance,
  listMemberWorkshops,
  listPendingWorkshopInvites,
  type WorkshopCard as WorkshopCardData,
} from '@/lib/coaching'
import { formatSessionTime } from '@/lib/mentoring-format'

export const metadata = { title: 'Coaching · Your coaching' }

function fmtStart(iso: string | null): string {
  if (!iso) return 'date TBC'
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(iso))
}

export default async function CoachingPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const [allowance, cards, invites, caps] = await Promise.all([
    getCoachingAllowance(member),
    listMemberWorkshops(member),
    listPendingWorkshopInvites(member),
    getHostCaps(member.id),
  ])
  const canCoach = member.isAdmin || caps.canCoach

  const active = cards.filter((c) => c.lifecycle === 'active')
  const completed = cards.filter((c) => c.lifecycle === 'archived')
  // "Request a session" targets the member's first active workshop (where they're
  // the coachee, not the coach).
  const requestTarget = active.find((c) => !c.isCoach) ?? null

  return (
    <div className="mx-auto max-w-content space-y-8">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-subheading text-[13px] font-semibold uppercase tracking-[0.13em] text-space-violet">
            Academy · Coaching
          </p>
          <h1 className="mt-1 font-display text-[34px] font-bold leading-tight tracking-[-0.02em] text-ink">
            Your coaching
          </h1>
          <p className="mt-1.5 max-w-xl text-[15px] text-content-secondary">
            One-on-one development with a Stellr coach — private live sessions, training, recordings, actions and
            chat, all in one workshop space.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canCoach && (
            <Link
              href="/community/coaching/coach"
              className="inline-flex items-center gap-2 rounded-[9px] border border-line px-4 py-2.5 text-sm font-semibold text-content-secondary transition-colors hover:border-space-violet hover:text-space-violet"
            >
              Coach workspace
            </Link>
          )}
          {requestTarget && (
            <Link
              href={`/community/coaching/${requestTarget.id}/access`}
              className="inline-flex items-center gap-2 rounded-[9px] bg-primary-soft px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/15"
            >
              Request a session →
            </Link>
          )}
        </div>
      </header>

      {/* Pending invites */}
      {invites.map((inv) => (
        <Link
          key={inv.workshopId}
          href={`/community/coaching/${inv.workshopId}/invite`}
          className="block rounded-[14px] border border-[#E2D9FB] p-5 transition-shadow hover:shadow-card-lift"
          style={{ background: 'linear-gradient(100deg,#F6F2FF,#fff 75%)', borderLeft: '3px solid #7C5CFC' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-subheading text-[12px] font-semibold uppercase tracking-[0.1em] text-space-violet">
                Pending invitation
              </p>
              <p className="mt-1 font-display text-[18px] font-bold text-ink">{inv.name}</p>
              <p className="mt-0.5 text-[13.5px] text-content-secondary">
                {inv.coachName ?? 'A Stellr coach'} · starts {fmtStart(inv.startDate)} · {inv.plannedSessions} sessions
              </p>
            </div>
            <span className="inline-flex items-center rounded-[9px] bg-space-violet px-4 py-2 text-sm font-semibold text-white">
              Review invite
            </span>
          </div>
        </Link>
      ))}

      {/* Active workshops */}
      <section className="space-y-3">
        {active.length === 0 && invites.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-line bg-white py-12 text-center">
            <p className="text-sm text-content-muted">
              You don&apos;t have a coaching workshop yet. Your coach or a Stellr admin will invite you to one.
            </p>
          </div>
        ) : (
          active.map((c) => <WorkshopCard key={c.id} c={c} />)
        )}
      </section>

      {/* Completed */}
      {completed.length > 0 && (
        <section>
          <h2 className="mb-2 font-subheading text-[12px] font-semibold uppercase tracking-[0.1em] text-content-faint">
            Completed
          </h2>
          <ul className="divide-y divide-line-light rounded-[14px] border border-line bg-white">
            {completed.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <span className="text-sm font-medium text-content-secondary">{c.name}</span>
                <Link href={`/community/coaching/${c.id}`} className="text-[13px] font-medium text-content-muted hover:text-primary">
                  Open archive →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Free-sessions footnote */}
      <p className="text-[13px] text-content-faint">
        Your membership ·{' '}
        <span className="font-semibold text-space-violet">
          {allowance.remaining} free coaching session{allowance.remaining === 1 ? '' : 's'} left
        </span>
        {allowance.extraCredits > 0 && <span className="text-primary"> · {allowance.extraCredits} purchased</span>}
        {allowance.tierName && <span> · included with your {allowance.tierName} membership</span>}
      </p>
    </div>
  )
}

function WorkshopCard({ c }: { c: WorkshopCardData }) {
  const next = c.nextSessionStart ? formatSessionTime(c.nextSessionStart, c.nextSessionEnd, c.timezone) : null
  // The "other party" line: coachees see their coach, coaches see their member.
  const counterpart = c.isCoach ? c.memberName : c.coachName
  return (
    <Link
      href={`/community/coaching/${c.id}`}
      className="group block rounded-card border border-line bg-white p-5 transition-all hover:-translate-y-px hover:shadow-card-lift"
    >
      <div className="flex flex-wrap items-start gap-4">
        {/* Violet coaching tile */}
        <div
          className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-[13px] font-display text-lg font-bold text-white"
          style={{ background: 'linear-gradient(150deg,#7C5CFC,#5B3FE0)' }}
        >
          {c.name.charAt(0)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-[20px] font-bold text-ink">{c.name}</h3>
            <span className="inline-flex items-center rounded-pill bg-space-violet-chip px-2.5 py-0.5 text-[11px] font-bold tracking-[0.04em] text-space-violet-text">
              SPACE
            </span>
            {c.isCoach && (
              <span className="inline-flex items-center rounded-pill bg-primary-soft px-2.5 py-0.5 text-[11px] font-bold text-primary">
                COACH
              </span>
            )}
          </div>
          <p className="mt-1 text-[13.5px] text-content-secondary">
            {counterpart ?? 'Stellr coach'} · 1-on-1 · {c.plannedSessions} sessions
          </p>

          <div className="mt-3 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-pill bg-[#EEF0F7]">
              <div className="h-full rounded-pill bg-space-violet" style={{ width: `${c.progressPct}%` }} />
            </div>
            <span className="text-[12px] font-semibold text-content-muted">{c.progressPct}%</span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2 text-right">
          {next ? (
            <div className="flex items-center gap-1.5 text-[13px] text-content-secondary">
              <Calendar className="h-3.5 w-3.5 text-content-faint" />
              <span>{next.dateShort} · {next.timeLine}</span>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-content-faint">
              <CalendarPlus className="h-3.5 w-3.5" /> No session scheduled
            </span>
          )}
          {c.actionsDue > 0 && (
            <span className="inline-flex items-center rounded-pill bg-enviro-green-bg px-2.5 py-0.5 text-[12px] font-semibold text-enviro-green-text">
              {c.actionsDue} action{c.actionsDue === 1 ? '' : 's'} due
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
