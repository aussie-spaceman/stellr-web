import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Calendar, Video } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { getWorkshopFull, resolveWorkshopAccess } from '@/lib/workshops'
import { listCohortRoster } from '@/lib/mentoring'
import { listCohortSessions } from '@/lib/sessions'
import { formatSessionTime, themeTile } from '@/lib/mentoring-format'

export const metadata = { title: 'Workshops · Workshop' }

export default async function WorkshopDetailPage({ params }: { params: Promise<{ workshopId: string }> }) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const { workshopId } = await params
  const workshop = await getWorkshopFull(workshopId)
  if (!workshop) notFound()

  const access = await resolveWorkshopAccess(member, workshop)
  const tile = themeTile(workshop.theme)

  // Not enrolled → invitation to register (or locked when closed).
  if (!access.enrolled) {
    return (
      <div className="mx-auto max-w-content space-y-6">
        <BackLink />
        <WorkshopHeader name={workshop.name} tile={tile} mentorName={workshop.mentorName} plannedSessions={workshop.plannedSessions} blurb={workshop.blurb} />
        <div className="rounded-card border border-line bg-white p-6 text-center">
          {workshop.isOpen ? (
            <>
              <p className="text-sm text-content-secondary">You&apos;re not registered for this workshop yet.</p>
              <Link
                href="/community/workshops/discover"
                className="mt-3 inline-flex items-center rounded-[9px] bg-space-violet px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#5B3FE0]"
              >
                Register from Discover
              </Link>
            </>
          ) : (
            <p className="text-sm text-content-muted">This workshop is not open for registration.</p>
          )}
        </div>
      </div>
    )
  }

  const [roster, sessions] = await Promise.all([listCohortRoster(workshopId), listCohortSessions(workshopId)])
  const now = Date.now()
  const upcoming = sessions
    .filter((s) => s.status === 'scheduled' && new Date(s.scheduled_start).getTime() > now)
    .sort((a, b) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime())
  const past = sessions.filter((s) => !(s.status === 'scheduled' && new Date(s.scheduled_start).getTime() > now))
  const activeRoster = roster.filter((r) => r.status === 'active')

  return (
    <div className="mx-auto max-w-content space-y-6">
      <BackLink />
      <WorkshopHeader name={workshop.name} tile={tile} mentorName={workshop.mentorName} plannedSessions={workshop.plannedSessions} blurb={workshop.blurb} />

      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        {/* Sessions */}
        <section className="space-y-4">
          <div className="rounded-card border border-line bg-white p-5">
            <h2 className="font-display text-[17px] font-bold text-ink">Upcoming sessions</h2>
            {upcoming.length === 0 ? (
              <p className="mt-2 text-sm text-content-muted">No sessions scheduled yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {upcoming.map((s) => {
                  const t = formatSessionTime(s.scheduled_start, s.scheduled_end, workshop.timezone)
                  return (
                    <li key={s.id} className="flex items-center justify-between gap-3 rounded-[10px] bg-surface px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Calendar className="h-4 w-4 text-space-violet" />
                        <div>
                          <p className="text-sm font-semibold text-ink">{s.title ?? 'Workshop session'}</p>
                          <p className="text-[12.5px] text-content-muted">{t.dateLine} · {t.timeLine}</p>
                        </div>
                      </div>
                      {s.join_url && (
                        <a href={s.join_url} className="inline-flex items-center gap-1.5 rounded-[8px] bg-space-violet px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[#5B3FE0]">
                          <Video className="h-3.5 w-3.5" /> Join
                        </a>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {past.length > 0 && (
            <div className="rounded-card border border-line bg-white p-5">
              <h2 className="font-display text-[17px] font-bold text-ink">Past sessions</h2>
              <ul className="mt-3 space-y-2">
                {past.map((s) => {
                  const t = formatSessionTime(s.scheduled_start, s.scheduled_end, workshop.timezone)
                  return (
                    <li key={s.id} className="flex items-center justify-between gap-3 px-1 py-1.5">
                      <span className="text-sm text-content-secondary">{s.title ?? 'Workshop session'} · {t.dateShort}</span>
                      {s.recording_status === 'available' && <span className="text-[12px] font-semibold text-enviro-green-text">Recording ready</span>}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </section>

        {/* Roster */}
        <aside className="rounded-card border border-line bg-white p-5">
          <h2 className="font-display text-[15px] font-bold text-ink">Participants · {activeRoster.length}</h2>
          <ul className="mt-3 space-y-1.5">
            {activeRoster.map((r) => (
              <li key={r.memberId} className="text-sm text-content-secondary">{r.name}</li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  )
}

function BackLink() {
  return (
    <Link href="/community/workshops" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-content-muted hover:text-primary">
      <ArrowLeft className="h-4 w-4" /> Your workshops
    </Link>
  )
}

function WorkshopHeader({
  name,
  tile,
  mentorName,
  plannedSessions,
  blurb,
}: {
  name: string
  tile: { gradient: string; chip: string; label: string }
  mentorName: string | null
  plannedSessions: number
  blurb: string | null
}) {
  return (
    <header className="flex items-start gap-4">
      <div className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-[13px] font-display text-lg font-bold text-white" style={{ background: tile.gradient }}>
        {name.charAt(0)}
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-[28px] font-bold tracking-[-0.02em] text-ink">{name}</h1>
          <span className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-[11px] font-bold tracking-[0.04em] ${tile.chip}`}>{tile.label}</span>
        </div>
        <p className="mt-0.5 text-[13.5px] text-content-secondary">
          {mentorName ?? 'Stellr coach'} · {plannedSessions} session{plannedSessions === 1 ? '' : 's'}
        </p>
        {blurb && <p className="mt-1.5 max-w-xl text-[14px] text-content-muted">{blurb}</p>}
      </div>
    </header>
  )
}
