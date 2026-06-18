// reference_components/HomeDashboard.tsx
// Reference shape for app/(member)/home/page.tsx (RSC). Shows the LAYOUT and
// brand styling; replace the inline sample data with the helpers in
// 03_DATA_CONTRACTS.md (getCurrentMember, getMemberEvents, getAssignedModules,
// listModules, sessions, getHomeFeed). Recreate idiomatically — this is a guide.

import Link from 'next/link'
import Image from 'next/image'
import { ProgressRing } from './ProgressRing'
import { Avatar } from './Avatar'

// --- shapes (map to real helper return types) ---
type NextEvent = { slug: string; title: string; date: string; venue: string; team?: string; prepDone: number; prepTotal: number }
type TrainingCard = { id: string; title: string; meta: string; pct: number }
type SessionCard = { id: string; title: string; meta: string; day: string; mon: string; tone: 'academy' | 'community' }
type FeedItem = { id: string; href: string; author: string; authorId: string; isMentor: boolean; spaceName: string; snippet: string; ago: string }

export function HomeDashboard({
  firstName, nextEvent, training, sessions, feed,
}: {
  firstName: string
  nextEvent: NextEvent | null
  training: TrainingCard[]
  sessions: SessionCard[]
  feed: FeedItem[]
}) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-subheading text-[15px] font-medium text-brand-muted-soft">Welcome back,</p>
          <h1 className="font-display text-display text-brand-blue-dark">{firstName} 👋</h1>
        </div>
      </header>

      {/* Next-event hero */}
      {nextEvent ? (
        <div className="relative mb-[18px] overflow-hidden rounded-card-lg p-6 text-white"
             style={{ background: 'linear-gradient(115deg,#da6220,#c2410c)' }}>
          <Image src="/images/logo-icon.svg" alt="" width={200} height={200}
                 className="pointer-events-none absolute -bottom-10 -right-8 opacity-[0.12] brightness-0 invert" />
          <div className="relative">
            <div className="mb-2.5 flex items-center gap-2.5">
              <span className="eyebrow rounded-full bg-white/20 px-2.5 py-1 text-[11px]">Your next competition</span>
              <span className="font-subheading text-[12.5px] font-semibold">in {daysUntil(nextEvent.date)} days</span>
            </div>
            <h2 className="font-heading text-[27px] uppercase">{nextEvent.title}</h2>
            <p className="mb-4 text-[13.5px] text-orange-100">{nextEvent.venue}{nextEvent.team ? ` · ${nextEvent.team}` : ''}</p>
            <div className="flex flex-wrap items-center gap-4">
              <div className="min-w-[200px] flex-1 rounded-xl bg-white/15 p-3">
                <p className="mb-1.5 font-subheading text-xs font-medium text-orange-100">
                  Prep checklist · {nextEvent.prepDone} of {nextEvent.prepTotal} done
                </p>
                <div className="h-[7px] overflow-hidden rounded bg-white/25">
                  <div className="h-full rounded bg-white" style={{ width: `${(nextEvent.prepDone / nextEvent.prepTotal) * 100}%` }} />
                </div>
              </div>
              <Link href={`/community/events/${nextEvent.slug}`}
                    className="rounded-xl bg-white px-5 py-2.5 font-subheading text-sm font-semibold text-[#c2410c]">
                View event hub →
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <EmptyHero />
      )}

      {/* Training + Sessions */}
      <div className="mb-[18px] grid gap-[18px] md:grid-cols-2">
        <section className="app-card p-5">
          <div className="mb-3.5 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-subheading text-base font-semibold">
              <Tri /> Finish your training
            </h3>
            <span className="font-subheading text-xs font-semibold text-brand-gold-ink">{training.length} due</span>
          </div>
          <ul className="space-y-3">
            {training.map((t) => (
              <li key={t.id} className="flex items-center gap-3">
                <ProgressRing pct={t.pct} />
                <span className="min-w-0">
                  <span className="block text-[14.5px] font-semibold text-brand-blue-dark">{t.title}</span>
                  <span className="block text-[12.5px] text-brand-muted-soft">{t.meta}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="app-card p-5">
          <h3 className="mb-3.5 flex items-center gap-2 font-subheading text-base font-semibold">
            <span className="h-[11px] w-[11px] rounded-full bg-brand-orange" /> Upcoming sessions
          </h3>
          <ul className="space-y-3">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3">
                <span className={`w-[46px] shrink-0 rounded-[10px] border py-1 text-center ${
                  s.tone === 'academy' ? 'border-[#ecdcb4] bg-[#fbf3e0]' : 'border-[#c6d6f0] bg-[#eaf0fa]'}`}>
                  <span className={`block font-heading text-[18px] leading-none ${s.tone === 'academy' ? 'text-brand-gold-ink' : 'text-brand-blue'}`}>{s.day}</span>
                  <span className={`block font-subheading text-[10px] font-semibold ${s.tone === 'academy' ? 'text-brand-gold-ink' : 'text-brand-blue'}`}>{s.mon}</span>
                </span>
                <span className="min-w-0">
                  <span className="block text-[14.5px] font-semibold text-brand-blue-dark">{s.title}</span>
                  <span className="block text-[12.5px] text-brand-muted-soft">{s.meta}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Community activity */}
      <section className="app-card p-5">
        <div className="mb-3.5 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-subheading text-base font-semibold">
            <span className="h-[11px] w-[11px] rounded-full bg-brand-blue" /> What&apos;s new in your spaces
          </h3>
          <Link href="/community" className="font-subheading text-xs font-semibold text-brand-blue">View all →</Link>
        </div>
        <ul className="divide-y divide-brand-hairline">
          {feed.map((f) => (
            <li key={f.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <Avatar id={f.authorId} name={f.author} size="md" />
              <Link href={f.href} className="min-w-0 flex-1">
                <span className="block text-[14.5px] text-brand-blue-dark">
                  <strong>{f.author}{f.isMentor ? ' (Mentor)' : ''}</strong> in{' '}
                  <span className="font-semibold text-brand-blue">{f.spaceName}</span>
                </span>
                <span className="block truncate text-[12.5px] text-brand-muted-soft">{f.snippet}</span>
              </Link>
              <span className="shrink-0 text-[11.5px] text-brand-muted-soft">{f.ago}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function Tri() {
  return <span className="inline-block h-0 w-0 border-x-[6px] border-b-[11px] border-x-transparent border-b-brand-orange" />
}
function daysUntil(iso: string) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000))
}
function EmptyHero() {
  return (
    <div className="app-card mb-[18px] flex flex-col items-center gap-3 p-10 text-center">
      <Image src="/images/logo-icon.svg" alt="" width={40} height={40} className="opacity-20" />
      <p className="text-brand-muted">No upcoming competitions yet.</p>
      <Link href="/events" className="btn-energy">Browse competitions</Link>
    </div>
  )
}
