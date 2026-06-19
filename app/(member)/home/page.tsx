import Link from 'next/link'
import Image from 'next/image'
import { redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/community'
import { getMemberEvents, getMemberEventCatalog } from '@/lib/event-portal'
import { getAssignedModules, listModules, type TrainingModuleSummary } from '@/lib/training'
import { listMemberSessions } from '@/lib/sessions'
import { getHomeFeed } from '@/lib/community-feed'
import { Avatar } from '@/components/ui/Avatar'
import { ProgressRing } from '@/components/ui/ProgressRing'
import { WelcomeBanner } from '@/components/community/WelcomeBanner'

export const metadata = { title: 'Home' }

// The member "Today" dashboard (T2.2) — the post-auth landing. Answers
// "what's happening and what do I do next?" Aggregates server-fetched data
// through existing lib/ helpers; no new queries inline.
export default async function HomePage() {
  const member = await getCurrentMember()
  if (!member) redirect('/account/onboarding')

  const firstName = member.first_name || 'there'

  // ---- Next competition + venue ----
  const [events, catalog] = await Promise.all([
    getMemberEvents(member),
    getMemberEventCatalog(member),
  ])
  const now = Date.now()
  const nextEvt =
    events
      .filter((e) => e.date && new Date(e.date).getTime() >= now)
      .sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime())[0] ?? null
  const nextCatalog = nextEvt ? catalog.find((c) => c.slug === nextEvt.slug) : undefined
  const venue = nextCatalog
    ? [nextCatalog.city, nextCatalog.state].filter(Boolean).join(', ')
    : ''

  // ---- Training (assignments + general library) ----
  const eventRefs = events.flatMap((e) => [e.eventId, e.slug]).filter((id): id is string => !!id)
  const eventRoles: string[] = []
  if (member.event_role) {
    eventRoles.push(member.event_role)
    if (member.event_role === 'school_student_manager') eventRoles.push('school_student')
  }
  const [assigned, allModules] = await Promise.all([
    getAssignedModules(member, { eventRefs, eventRoles }),
    listModules(member),
  ])

  // Prep checklist on the hero = mandatory assigned modules for the next event.
  const mandatory = assigned.filter((m) => m.isMandatory && m.itemCount > 0)
  const prepTotal = mandatory.length
  const prepDone = mandatory.filter((m) => m.completedCount >= m.itemCount).length

  // "Finish your training" = incomplete modules, mandatory first.
  const seen = new Set<string>()
  const incomplete = [...assigned, ...allModules]
    .filter((m) => {
      if (seen.has(m.id)) return false
      seen.add(m.id)
      return m.itemCount > 0 && m.completedCount < m.itemCount && m.canAccess
    })
    .sort((a, b) => Number(b.isMandatory) - Number(a.isMandatory))
    .slice(0, 4)

  // ---- Upcoming sessions ----
  const sessions = (await listMemberSessions(member.id))
    .filter((s) => s.status === 'scheduled' && new Date(s.scheduled_start).getTime() >= now)
    .sort((a, b) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime())
    .slice(0, 4)

  // ---- Community activity ----
  const feed = (await getHomeFeed(member, 6)).slice(0, 6)

  return (
    <div className="mx-auto max-w-4xl">
      <WelcomeBanner firstName={firstName} />

      {/* Header */}
      <header className="mb-6">
        <p className="font-subheading text-[15px] font-medium text-brand-muted-soft">Welcome back,</p>
        <h1 className="font-display text-display text-brand-blue-dark">{firstName} 👋</h1>
      </header>

      {/* Next-event hero */}
      {nextEvt ? (
        <div
          className="relative mb-[18px] overflow-hidden rounded-card-lg p-6 text-white"
          style={{ background: 'linear-gradient(115deg,#E0922F,#C2722A)' }}
        >
          <Image
            src="/images/logo-icon.svg"
            alt=""
            width={200}
            height={200}
            className="pointer-events-none absolute -bottom-10 -right-8 opacity-[0.12] brightness-0 invert"
          />
          <div className="relative">
            <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
              <span className="eyebrow rounded-full bg-white/20 px-2.5 py-1 text-[11px]">
                Your next {nextEvt.activityType === 'campaign' ? 'campaign' : 'competition'}
              </span>
              <span className="font-subheading text-[12.5px] font-semibold">in {daysUntil(nextEvt.date!)} days</span>
            </div>
            <h2 className="font-heading text-[27px] uppercase">{nextEvt.title}</h2>
            <p className="mb-4 text-[13.5px] text-orange-100">
              {fmtDate(nextEvt.date!)}
              {venue ? ` · ${venue}` : ''}
            </p>
            <div className="flex flex-wrap items-center gap-4">
              {prepTotal > 0 && (
                <div className="min-w-[200px] flex-1 rounded-xl bg-white/15 p-3">
                  <p className="mb-1.5 font-subheading text-xs font-medium text-orange-100">
                    Prep checklist · {prepDone} of {prepTotal} done
                  </p>
                  <div className="h-[7px] overflow-hidden rounded bg-white/25">
                    <div className="bar-animate h-full rounded bg-white" style={{ width: `${(prepDone / prepTotal) * 100}%` }} />
                  </div>
                </div>
              )}
              <Link
                href={`/community/events/${nextEvt.slug}`}
                className="rounded-xl bg-white px-5 py-2.5 font-subheading text-sm font-semibold text-[#C2722A]"
              >
                View event hub →
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="app-card mb-[18px] flex flex-col items-center gap-3 p-10 text-center">
          <Image src="/images/logo-icon.svg" alt="" width={40} height={40} className="opacity-20" />
          <p className="text-brand-muted">No upcoming competitions yet.</p>
          <Link href="/events" className="btn-energy">Browse competitions</Link>
        </div>
      )}

      {/* Training + Sessions */}
      <div className="mb-[18px] grid gap-[18px] md:grid-cols-2">
        <section className="app-card p-5">
          <div className="mb-3.5 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-subheading text-base font-semibold text-brand-blue-dark">
              <Tri /> Finish your training
            </h3>
            {incomplete.length > 0 && (
              <span className="font-subheading text-xs font-semibold text-brand-gold-ink">{incomplete.length} due</span>
            )}
          </div>
          {incomplete.length > 0 ? (
            <ul className="space-y-3">
              {incomplete.map((t) => (
                <li key={t.id}>
                  <Link href={`/community/training/${t.id}`} className="flex items-center gap-3">
                    <ProgressRing pct={pct(t)} />
                    <span className="min-w-0">
                      <span className="block text-[14.5px] font-semibold text-brand-blue-dark">{t.title}</span>
                      <span className="block text-[12.5px] text-brand-muted-soft">{moduleMeta(t)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="py-4 text-sm text-brand-muted">
              You&apos;re all caught up on training. 🎉{' '}
              <Link href="/community/training" className="font-semibold text-brand-blue">Explore the library</Link>
            </div>
          )}
        </section>

        <section className="app-card p-5">
          <h3 className="mb-3.5 flex items-center gap-2 font-subheading text-base font-semibold text-brand-blue-dark">
            <span className="h-[11px] w-[11px] rounded-full bg-brand-orange" /> Upcoming sessions
          </h3>
          {sessions.length > 0 ? (
            <ul className="space-y-3">
              {sessions.map((s) => {
                const academy = s.session_type === 'mentoring'
                return (
                  <li key={s.id} className="flex items-center gap-3">
                    <span
                      className={`w-[46px] shrink-0 rounded-[10px] border py-1 text-center ${
                        academy ? 'border-[#ecdcb4] bg-[#fbf3e0]' : 'border-[#c6d6f0] bg-[#eaf0fa]'
                      }`}
                    >
                      <span className={`block font-heading text-[18px] leading-none ${academy ? 'text-brand-gold-ink' : 'text-brand-blue'}`}>
                        {dayNum(s.scheduled_start)}
                      </span>
                      <span className={`block font-subheading text-[10px] font-semibold ${academy ? 'text-brand-gold-ink' : 'text-brand-blue'}`}>
                        {monShort(s.scheduled_start)}
                      </span>
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[14.5px] font-semibold text-brand-blue-dark">
                        {s.title || (academy ? 'Mentoring session' : 'Coaching session')}
                      </span>
                      <span className="block text-[12.5px] text-brand-muted-soft capitalize">
                        {s.session_type} · {fmtTime(s.scheduled_start)}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="py-4 text-sm text-brand-muted">No sessions scheduled yet.</p>
          )}
        </section>
      </div>

      {/* Community activity */}
      <section className="app-card p-5">
        <div className="mb-3.5 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-subheading text-base font-semibold text-brand-blue-dark">
            <span className="h-[11px] w-[11px] rounded-full bg-brand-blue" /> What&apos;s new in your spaces
          </h3>
          <Link href="/community" className="font-subheading text-xs font-semibold text-brand-blue">View all →</Link>
        </div>
        {feed.length > 0 ? (
          <ul className="divide-y divide-brand-hairline">
            {feed.map((f) => (
              <li key={f.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <Avatar id={f.authorId || f.authorName} name={f.authorName} size="md" color={f.isMentor ? '#E0922F' : undefined} />
                <Link href={`/community/${f.spaceSlug}/${f.id}`} className="min-w-0 flex-1">
                  <span className="block text-[14.5px] text-brand-blue-dark">
                    <strong>{f.authorName}</strong>
                    {f.isMentor && <span className="font-semibold text-brand-orange-alt"> (Mentor)</span>} in{' '}
                    <span className="font-semibold text-brand-blue">{f.spaceName}</span>
                  </span>
                  <span className="block truncate text-[12.5px] text-brand-muted-soft">{f.title}</span>
                </Link>
                {f.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-orange-alt" aria-label="unread" />}
                <span className="shrink-0 text-[11.5px] text-brand-muted-soft">{timeAgo(f.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-4 text-sm text-brand-muted">
            Your spaces are quiet right now.{' '}
            <Link href="/community" className="font-semibold text-brand-blue">Start a discussion →</Link>
          </p>
        )}
      </section>
    </div>
  )
}

function pct(m: TrainingModuleSummary) {
  return m.itemCount > 0 ? Math.round((m.completedCount / m.itemCount) * 100) : 0
}
function moduleMeta(m: TrainingModuleSummary) {
  const left = m.itemCount - m.completedCount
  return `${left} lesson${left === 1 ? '' : 's'} left${m.isMandatory ? ' · Mandatory' : ''}`
}
function Tri() {
  return <span className="inline-block h-0 w-0 border-x-[6px] border-b-[11px] border-x-transparent border-b-brand-orange" />
}
function daysUntil(iso: string) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000))
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Denver' })
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver' })
}
function dayNum(iso: string) {
  return Number(new Date(iso).toLocaleDateString('en-US', { day: 'numeric', timeZone: 'America/Denver' }))
}
function monShort(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', timeZone: 'America/Denver' }).toUpperCase()
}
function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}
