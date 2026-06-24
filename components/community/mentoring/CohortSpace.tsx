'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Calendar, CalendarPlus, Video, FileText, BookOpen, Link2, Clock, Check,
} from 'lucide-react'
import { ChatPanel } from '@/components/community/ChatPanel'
import { JoinButton } from '@/components/community/JoinButton'
import { MaterialDownloadButton } from '@/components/community/MaterialDownloadButton'
import { formatSessionTime, themeTile, type CohortTheme } from '@/lib/mentoring-format'

type Tab = 'overview' | 'sessions' | 'resources' | 'actions' | 'chat'

interface CohortMeta {
  id: string
  name: string
  theme: CohortTheme
  timezone: string
  mentorName: string | null
  memberCount: number
  isMentor: boolean
  lifecycle: 'active' | 'archived'
}
interface SessionRow {
  id: string
  title: string | null
  start: string
  end: string | null
  status: string
  recordingStatus: string
}
interface ResourceRow {
  moduleId: string
  title: string
  isMandatory: boolean
  dueAt: string | null
  itemCount: number
  completedCount: number
  canAccess: boolean
}
interface ActionRow {
  id: string
  title: string
  isDone: boolean
  dueDate: string | null
  kind: 'training' | 'task'
}

export function CohortSpace(props: {
  cohort: CohortMeta
  roster: { name: string; status: string }[]
  sessions: SessionRow[]
  resources: ResourceRow[]
  recordings: { id: string; title: string | null; start: string }[]
  actions: ActionRow[]
  nextSession: { id: string; title: string | null; start: string; end: string | null; gcalUrl: string | null } | null
  lastMessage: { author: string; body: string } | null
  channelId: string
  selfMemberId: string
  selfName?: string
}) {
  const { cohort } = props
  const [tab, setTab] = useState<Tab>('overview')
  const tile = themeTile(cohort.theme)

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'sessions', label: 'Sessions' },
    { key: 'resources', label: 'Resources' },
    { key: 'actions', label: 'Actions', count: props.actions.filter((a) => !a.isDone).length || undefined },
    { key: 'chat', label: 'Chat' },
  ]

  return (
    <div className="mx-auto max-w-content space-y-6">
      {/* ── Mini-hero ── */}
      <div
        className="relative overflow-hidden rounded-panel px-7 pt-6 text-white"
        style={{ background: 'radial-gradient(130% 150% at 88% -30%, #36306F, #181D44 48%, #0E1330)' }}
      >
        <StarDots />
        <div className="relative">
          <p className="text-[12.5px] text-hero-dim">
            <Link href="/community/mentoring" className="hover:text-white">Mentoring</Link>
            <span className="mx-1.5 text-white/30">/</span>
            <span className="text-hero-lead">{cohort.name}</span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="font-display text-[30px] font-bold tracking-[-0.02em]">{cohort.name}</h1>
            <span className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-[11px] font-bold tracking-[0.04em] ${tile.chip}`}>
              {tile.label}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center -space-x-2">
                <Avatar name={cohort.mentorName ?? 'Mentor'} bg="#16B6C4" ring />
                {props.roster.filter((r) => r.status === 'active').slice(0, 3).map((r, i) => (
                  <Avatar key={i} name={r.name} bg="#3C6DF6" ring />
                ))}
                {cohort.memberCount > 3 && (
                  <span className="z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-[11px] font-semibold ring-2 ring-[#181D44]">
                    +{cohort.memberCount - 3}
                  </span>
                )}
              </div>
              <p className="text-[13px] text-hero-lead">
                {cohort.mentorName ?? 'Stellr mentor'} · {cohort.memberCount} member{cohort.memberCount === 1 ? '' : 's'}
              </p>
            </div>
            <span className="rounded-pill border border-white/15 bg-white/5 px-3.5 py-1.5 text-[12.5px] font-medium text-hero-lead">
              My access · Included with membership
            </span>
          </div>

          {/* Tab bar */}
          <nav className="mt-5 flex gap-6 border-b border-white/10">
            {TABS.map((t) => {
              const active = tab === t.key
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`relative -mb-px pb-3 text-sm transition-colors ${
                    active ? 'font-bold text-white' : 'font-medium text-hero-dim hover:text-hero-lead'
                  }`}
                >
                  {t.label}
                  {t.count ? <span className="ml-1.5 text-[11px] text-star-gold">{t.count}</span> : null}
                  {active && <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-t bg-star-gold" />}
                </button>
              )
            })}
          </nav>
        </div>
      </div>

      {/* ── Panes ── */}
      {tab === 'overview' && <OverviewPane {...props} />}
      {tab === 'sessions' && <SessionsPane sessions={props.sessions} tz={cohort.timezone} isMentor={cohort.isMentor} />}
      {tab === 'resources' && <ResourcesPane resources={props.resources} recordings={props.recordings} tz={cohort.timezone} />}
      {tab === 'actions' && <ActionsPane actions={props.actions} tz={cohort.timezone} mentorName={cohort.mentorName} />}
      {tab === 'chat' && (
        <ChatPanel
          channelId={props.channelId}
          selfMemberId={props.selfMemberId}
          selfName={props.selfName}
          title={cohort.name}
          canModerate={cohort.isMentor}
        />
      )}
    </div>
  )
}

// ── Overview ──────────────────────────────────────────────────────────────
function OverviewPane(props: React.ComponentProps<typeof CohortSpace>) {
  const { cohort, nextSession, resources, actions, lastMessage } = props
  const next = nextSession ? formatSessionTime(nextSession.start, nextSession.end, cohort.timezone) : null
  const mandatory = resources.filter((r) => r.isMandatory && !(r.itemCount > 0 && r.completedCount >= r.itemCount))
  const openActions = actions.filter((a) => !a.isDone)
  const done = actions.length - openActions.length
  const totalUnits = props.sessions.length + resources.length + actions.length
  const doneUnits =
    props.sessions.filter((s) => s.status === 'completed').length +
    resources.filter((r) => r.itemCount > 0 && r.completedCount >= r.itemCount).length +
    done
  const pct = totalUnits > 0 ? Math.round((doneUnits / totalUnits) * 100) : 0

  return (
    <div className="grid gap-5 lg:grid-cols-[1.55fr_1fr]">
      <div className="space-y-5">
        {/* Next live session */}
        {next && nextSession ? (
          <div className="overflow-hidden rounded-card border-2 border-space-violet bg-white">
            <div className="bg-space-violet px-5 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white">
              Next live session
            </div>
            <div className="p-5">
              <h3 className="font-display text-[19px] font-bold text-ink">{nextSession.title ?? 'Mentoring session'}</h3>
              <p className="mt-1 flex items-center gap-1.5 text-[14px] text-content-secondary">
                <Calendar className="h-4 w-4 text-content-faint" /> {next.full}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <JoinButton sessionId={nextSession.id} scheduledStart={nextSession.start} isHost={cohort.isMentor} />
                {nextSession.gcalUrl && (
                  <a
                    href={nextSession.gcalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-[9px] bg-primary-soft px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary/15"
                  >
                    <CalendarPlus className="h-4 w-4" /> Add to Google Calendar
                  </a>
                )}
              </div>
            </div>
          </div>
        ) : (
          <Card>
            <p className="text-sm text-content-muted">No live session scheduled yet. Your mentor will add sessions soon.</p>
          </Card>
        )}

        {/* Mandatory before next session */}
        {mandatory.length > 0 && (
          <Card>
            <CardHeading>Mandatory before next session</CardHeading>
            <ul className="mt-3 space-y-2">
              {mandatory.map((r) => (
                <li key={r.moduleId} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm text-content-body">
                    <span className="inline-flex items-center rounded-pill bg-space-violet-chip px-2 py-0.5 text-[10px] font-bold text-space-violet-text">DUE SOON</span>
                    {r.title}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* From the cohort chat */}
        {lastMessage && (
          <Card>
            <CardHeading>From the cohort chat</CardHeading>
            <div className="mt-3 rounded-[12px] bg-space-violet-bg p-4">
              <p className="text-[12px] font-semibold text-space-violet-text">{lastMessage.author}</p>
              <p className="mt-1 line-clamp-3 text-sm text-content-body">{lastMessage.body}</p>
            </div>
          </Card>
        )}
      </div>

      {/* Right rail */}
      <div className="space-y-5">
        <Card>
          <div className="flex items-center justify-between">
            <CardHeading>My actions</CardHeading>
            {openActions.length > 0 && (
              <span className="rounded-pill bg-enviro-green-bg px-2.5 py-0.5 text-[12px] font-semibold text-enviro-green-text">
                {openActions.length} open
              </span>
            )}
          </div>
          {actions.length === 0 ? (
            <p className="mt-3 text-sm text-content-muted">No actions assigned yet.</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {actions.slice(0, 5).map((a) => (
                <li key={a.id} className="flex items-start gap-2.5 text-sm">
                  <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${a.isDone ? 'border-enviro-green bg-enviro-green' : 'border-content-faint'}`}>
                    {a.isDone && <Check className="h-3 w-3 text-white" />}
                  </span>
                  <span className={a.isDone ? 'text-content-faint line-through' : 'text-content-body'}>{a.title}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeading>Cohort progress</CardHeading>
          <p className="mt-2 font-display text-[32px] font-bold text-space-violet">{pct}%</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-pill bg-[#EEF0F7]">
            <div className="h-full rounded-pill bg-space-violet" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-[12.5px] text-content-muted">
            {props.sessions.filter((s) => s.status === 'completed').length} sessions ·{' '}
            {resources.filter((r) => r.itemCount > 0 && r.completedCount >= r.itemCount).length} resources · {done} actions done
          </p>
        </Card>
      </div>
    </div>
  )
}

// ── Sessions ────────────────────────────────────────────────────────────────
function SessionsPane({ sessions, tz, isMentor }: { sessions: SessionRow[]; tz: string; isMentor: boolean }) {
  const now = Date.now()
  const sorted = [...sessions].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
  const nextId = sorted.find((s) => s.status === 'scheduled' && new Date(s.start).getTime() > now)?.id

  if (sessions.length === 0) {
    return <Card><p className="text-sm text-content-muted">No sessions scheduled yet.</p></Card>
  }
  return (
    <Card>
      <ul className="divide-y divide-line-light">
        {sorted.map((s) => {
          const t = formatSessionTime(s.start, s.end, tz)
          const isPast = new Date(s.start).getTime() < now || s.status === 'completed'
          const isNext = s.id === nextId
          const badge = isNext
            ? { text: 'NEXT', cls: 'bg-space-violet-chip text-space-violet-text' }
            : s.recordingStatus === 'available'
              ? { text: 'RECORDED', cls: 'bg-surface text-content-muted' }
              : { text: 'SCHEDULED', cls: 'bg-primary-soft text-primary' }
          return (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
              <div className="flex items-center gap-3">
                <span className={`h-2 w-2 rounded-full ${isNext ? 'bg-space-violet' : isPast ? 'bg-content-faint' : 'bg-primary'}`} />
                <div>
                  <p className="flex items-center gap-2 font-medium text-ink">
                    {s.title ?? 'Mentoring session'}
                    <span className={`rounded-pill px-2 py-0.5 text-[10px] font-bold tracking-[0.04em] ${badge.cls}`}>{badge.text}</span>
                  </p>
                  <p className="text-[13px] text-content-secondary">{t.dateShort} · {t.timeLine}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {s.recordingStatus === 'available' ? (
                  <MaterialDownloadButton endpoint={`/api/community/sessions/${s.id}/recording`} title={`${s.title ?? 'session'}-recording`} label="Watch recording" />
                ) : (
                  !isPast && <JoinButton sessionId={s.id} scheduledStart={s.start} isHost={isMentor} />
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

// ── Resources ─────────────────────────────────────────────────────────────
function ResourcesPane({
  resources,
  recordings,
  tz,
}: {
  resources: ResourceRow[]
  recordings: { id: string; title: string | null; start: string }[]
  tz: string
}) {
  if (resources.length === 0 && recordings.length === 0) {
    return <Card><p className="text-sm text-content-muted">No resources yet. Session recordings appear here automatically.</p></Card>
  }
  return (
    <div className="space-y-3">
      {resources.map((r) => {
        const done = r.itemCount > 0 && r.completedCount >= r.itemCount
        const inner = (
          <div className="flex items-center justify-between gap-3 rounded-card border border-line bg-white p-4">
            <div className="flex items-center gap-3">
              <IconTile kind="course" />
              <div>
                <p className="flex items-center gap-2 font-medium text-ink">
                  {r.title}
                  <span className={`rounded-pill px-2 py-0.5 text-[10px] font-bold ${r.isMandatory ? 'bg-space-violet-chip text-space-violet-text' : 'bg-surface text-content-muted'}`}>
                    {r.isMandatory ? 'MANDATORY' : 'OPTIONAL'}
                  </span>
                </p>
                <p className="text-[12.5px] text-content-muted">
                  Course · {r.completedCount}/{r.itemCount} complete
                  {r.dueAt && <> · due {new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: tz }).format(new Date(r.dueAt))}</>}
                </p>
              </div>
            </div>
            <span className="text-[13px] font-semibold text-primary">
              {done ? 'Done' : r.canAccess ? (r.completedCount > 0 ? 'Resume →' : 'Open →') : 'Locked'}
            </span>
          </div>
        )
        return (
          <div key={r.moduleId}>
            {r.canAccess ? <Link href={`/community/training/${r.moduleId}`}>{inner}</Link> : inner}
          </div>
        )
      })}
      {recordings.map((s) => (
        <div key={s.id} className="flex items-center justify-between gap-3 rounded-card border border-line bg-white p-4">
          <div className="flex items-center gap-3">
            <IconTile kind="recording" />
            <div>
              <p className="flex items-center gap-2 font-medium text-ink">
                {s.title ?? 'Session recording'}
                <span className="rounded-pill bg-surface px-2 py-0.5 text-[10px] font-bold text-content-muted">RECORDING</span>
              </p>
              <p className="text-[12.5px] text-content-muted">
                Recording · {new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: tz }).format(new Date(s.start))}
              </p>
            </div>
          </div>
          <MaterialDownloadButton endpoint={`/api/community/sessions/${s.id}/recording`} title={`${s.title ?? 'session'}-recording`} label="Watch" />
        </div>
      ))}
      <p className="pt-1 text-[12.5px] text-content-faint">Yours to access in perpetuity.</p>
    </div>
  )
}

// ── Actions ─────────────────────────────────────────────────────────────────
function ActionsPane({ actions, tz, mentorName }: { actions: ActionRow[]; tz: string; mentorName: string | null }) {
  const [items, setItems] = useState(actions)
  const todo = items.filter((a) => !a.isDone).length
  const done = items.length - todo

  const toggle = async (id: string, current: boolean) => {
    setItems((prev) => prev.map((a) => (a.id === id ? { ...a, isDone: !current } : a)))
    const res = await fetch('/api/community/sessions/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId: id, done: !current }),
    })
    if (!res.ok) setItems((prev) => prev.map((a) => (a.id === id ? { ...a, isDone: current } : a)))
  }

  if (items.length === 0) return <Card><p className="text-sm text-content-muted">No actions assigned yet.</p></Card>
  return (
    <Card>
      <div className="mb-3 flex gap-4 text-[13px] font-semibold">
        <span className="text-pathway-amber">{todo} to do</span>
        <span className="text-enviro-green-text">{done} done</span>
      </div>
      <ul className="divide-y divide-line-light">
        {items.map((a) => (
          <li key={a.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <button
              onClick={() => toggle(a.id, a.isDone)}
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${a.isDone ? 'border-enviro-green bg-enviro-green' : 'border-content-faint hover:border-enviro-green'}`}
              aria-label={a.isDone ? 'Mark not done' : 'Mark done'}
            >
              {a.isDone && <Check className="h-3.5 w-3.5 text-white" />}
            </button>
            <div className="min-w-0 flex-1">
              <p className={`flex flex-wrap items-center gap-2 font-medium ${a.isDone ? 'text-content-faint line-through' : 'text-ink'}`}>
                {a.title}
                <span className={`rounded-pill px-2 py-0.5 text-[10px] font-bold ${a.kind === 'training' ? 'bg-space-violet-chip text-space-violet-text' : 'bg-primary-soft text-primary'}`}>
                  {a.kind === 'training' ? 'TRAINING' : 'TASK'}
                </span>
              </p>
              <p className="mt-0.5 flex items-center gap-2 text-[12.5px] text-content-muted">
                {a.dueDate && (
                  <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> due {new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: tz }).format(new Date(a.dueDate))}</span>
                )}
                {mentorName && <span>from {mentorName}</span>}
              </p>
            </div>
            <span className={`shrink-0 rounded-pill px-2.5 py-0.5 text-[11px] font-semibold ${a.isDone ? 'bg-enviro-green-bg text-enviro-green-text' : 'bg-pathway-amber-bg text-[#C2722A]'}`}>
              {a.isDone ? 'Done' : 'To do'}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

// ── Shared bits ─────────────────────────────────────────────────────────────
function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-card border border-line bg-white p-5">{children}</div>
}
function CardHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="font-display text-[15px] font-bold text-ink">{children}</h3>
}
function Avatar({ name, bg, ring }: { name: string; bg: string; ring?: boolean }) {
  return (
    <span
      className={`z-10 flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-semibold text-white ${ring ? 'ring-2 ring-[#181D44]' : ''}`}
      style={{ background: bg }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  )
}
function IconTile({ kind }: { kind: 'course' | 'file' | 'recording' | 'link' }) {
  const map = {
    course: { bg: '#F6F2FF', fg: '#7C5CFC', Icon: BookOpen },
    file: { bg: '#EAF0FE', fg: '#3C6DF6', Icon: FileText },
    recording: { bg: '#FCEEF0', fg: '#D9433C', Icon: Video },
    link: { bg: '#EDFAF4', fg: '#1FA97A', Icon: Link2 },
  }[kind]
  const { Icon } = map
  return (
    <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px]" style={{ background: map.bg, color: map.fg }}>
      <Icon className="h-[18px] w-[18px]" />
    </span>
  )
}
function StarDots() {
  const dots = [
    [12, 30], [28, 64], [60, 20], [85, 48], [70, 78], [40, 18], [92, 70], [18, 80], [50, 50], [78, 14],
  ]
  return (
    <div className="pointer-events-none absolute inset-0">
      {dots.map(([x, y], i) => (
        <span key={i} className="absolute h-[2px] w-[2px] rounded-full bg-white/40" style={{ left: `${x}%`, top: `${y}%` }} />
      ))}
    </div>
  )
}
