'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Calendar, CalendarPlus, Video, FileText, BookOpen, Link2, Clock, Check, Play,
} from 'lucide-react'
import { ChatPanel } from '@/components/community/ChatPanel'
import { JoinButton } from '@/components/community/JoinButton'
import { MaterialDownloadButton } from '@/components/community/MaterialDownloadButton'
import { ResourceDownloadButton } from '@/components/community/ResourceDownloadButton'
import { formatSessionTime } from '@/lib/mentoring-format'

type Tab = 'overview' | 'sessions' | 'training' | 'recordings' | 'actions' | 'chat'

interface WorkshopMeta {
  id: string
  name: string
  timezone: string
  coachName: string | null
  memberName: string | null
  isCoach: boolean
  lifecycle: 'active' | 'archived'
}
interface SessionRow { id: string; title: string | null; start: string; end: string | null; status: string; recordingStatus: string }
interface ResourceRow { moduleId: string; title: string; isMandatory: boolean; dueAt: string | null; itemCount: number; completedCount: number; canAccess: boolean }
interface ActionRow { id: string; title: string; isDone: boolean; dueDate: string | null; kind: 'training' | 'task' }
interface FileResourceRow { resourceId: string; title: string; fileType: string | null; isMandatory: boolean; dueAt: string | null }

type Props = {
  workshop: WorkshopMeta
  allowanceRemaining: number
  sessions: SessionRow[]
  resources: ResourceRow[]
  recordings: { id: string; title: string | null; start: string; end: string | null }[]
  fileResources: FileResourceRow[]
  actions: ActionRow[]
  nextSession: { id: string; title: string | null; start: string; end: string | null; gcalUrl: string | null } | null
  lastMessage: { author: string; body: string } | null
  channelId: string
  selfMemberId: string
  selfName?: string
}

export function WorkshopSpace(props: Props) {
  const { workshop } = props
  const [tab, setTab] = useState<Tab>('overview')
  const [actions, setActions] = useState(props.actions)

  // Shared action toggle so the Overview mini-checklist and the Actions tab stay
  // in sync (optimistic, reverts on failure).
  const toggleAction = async (id: string, current: boolean) => {
    setActions((prev) => prev.map((a) => (a.id === id ? { ...a, isDone: !current } : a)))
    const res = await fetch('/api/community/sessions/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId: id, done: !current }),
    })
    if (!res.ok) setActions((prev) => prev.map((a) => (a.id === id ? { ...a, isDone: current } : a)))
  }

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'sessions', label: 'Sessions' },
    { key: 'training', label: 'Training' },
    { key: 'recordings', label: 'Recordings' },
    { key: 'actions', label: 'Actions', count: actions.filter((a) => !a.isDone).length || undefined },
    { key: 'chat', label: 'Chat' },
  ]

  // Breadcrumb / counterpart: coachee sees their coach; coach sees their member.
  const counterpart = workshop.isCoach ? workshop.memberName : workshop.coachName
  const crumb = [workshop.coachName, workshop.memberName].filter(Boolean).join(' & ') || workshop.name

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
            <Link href="/community/coaching" className="hover:text-white">Coaching</Link>
            <span className="mx-1.5 text-white/30">/</span>
            <span className="text-hero-lead">{crumb}</span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="font-display text-[30px] font-bold tracking-[-0.02em]">{workshop.name}</h1>
            <span className="inline-flex items-center rounded-pill bg-space-violet-chip px-2.5 py-0.5 text-[11px] font-bold tracking-[0.04em] text-space-violet-text">
              SPACE
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Avatar name={workshop.coachName ?? 'Coach'} bg="#16B6C4" ring />
              <p className="text-[13px] text-hero-lead">
                {counterpart ?? 'Stellr coach'} · 1-on-1
              </p>
            </div>
            {workshop.isCoach ? (
              <Link
                href={`/community/coaching/coach/${workshop.id}`}
                className="rounded-pill border border-white/15 bg-white/5 px-3.5 py-1.5 text-[12.5px] font-medium text-hero-lead transition-colors hover:bg-white/10"
              >
                Manage workshop →
              </Link>
            ) : (
              <Link
                href={`/community/coaching/${workshop.id}/access`}
                className="rounded-pill border border-white/15 bg-white/5 px-3.5 py-1.5 text-[12.5px] font-medium text-hero-lead transition-colors hover:bg-white/10"
              >
                My access · {props.allowanceRemaining} free session{props.allowanceRemaining === 1 ? '' : 's'} left · Included with membership →
              </Link>
            )}
          </div>

          {/* Tab bar */}
          <nav className="mt-5 flex gap-6 overflow-x-auto border-b border-white/10">
            {TABS.map((t) => {
              const active = tab === t.key
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`relative -mb-px shrink-0 pb-3 text-sm transition-colors ${active ? 'font-bold text-white' : 'font-medium text-hero-dim hover:text-hero-lead'}`}
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
      {tab === 'overview' && <OverviewPane {...props} actions={actions} onToggle={toggleAction} />}
      {tab === 'sessions' && <SessionsPane sessions={props.sessions} tz={workshop.timezone} isCoach={workshop.isCoach} workshopId={workshop.id} />}
      {tab === 'training' && <TrainingPane resources={props.resources} fileResources={props.fileResources} tz={workshop.timezone} />}
      {tab === 'recordings' && <RecordingsPane recordings={props.recordings} tz={workshop.timezone} />}
      {tab === 'actions' && <ActionsPane actions={actions} onToggle={toggleAction} tz={workshop.timezone} coachName={workshop.coachName} />}
      {tab === 'chat' && (
        <ChatPanel
          channelId={props.channelId}
          selfMemberId={props.selfMemberId}
          selfName={props.selfName}
          title={`Chat with ${counterpart ?? 'your coach'}`}
          canModerate={workshop.isCoach}
        />
      )}
    </div>
  )
}

// ── Overview ──────────────────────────────────────────────────────────────
function OverviewPane(props: Props & { onToggle: (id: string, current: boolean) => void }) {
  const { workshop, nextSession, resources, actions, lastMessage, onToggle } = props
  const next = nextSession ? formatSessionTime(nextSession.start, nextSession.end, workshop.timezone) : null
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
        {next && nextSession ? (
          <div className="overflow-hidden rounded-card border-2 border-space-violet bg-white">
            <div className="bg-space-violet px-5 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white">
              Next live session
            </div>
            <div className="p-5">
              <h3 className="font-display text-[19px] font-bold text-ink">{nextSession.title ?? 'Coaching session'}</h3>
              <p className="mt-1 flex items-center gap-1.5 text-[14px] text-content-secondary">
                <Calendar className="h-4 w-4 text-content-faint" /> {next.full}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <JoinButton sessionId={nextSession.id} scheduledStart={nextSession.start} isHost={workshop.isCoach} />
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
            <p className="text-sm text-content-muted">
              No live session scheduled yet.{' '}
              {!workshop.isCoach && (
                <Link href={`/community/coaching/${workshop.id}/access`} className="font-semibold text-primary hover:underline">
                  Request a session →
                </Link>
              )}
            </p>
          </Card>
        )}

        {mandatory.length > 0 && (
          <Card>
            <CardHeading>Mandatory before next session</CardHeading>
            <ul className="mt-3 space-y-2">
              {mandatory.map((r) => (
                <li key={r.moduleId} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm text-content-body">
                    <span className="inline-flex items-center rounded-pill bg-space-violet-chip px-2 py-0.5 text-[10px] font-bold text-space-violet-text">
                      {r.dueAt ? `DUE ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: workshop.timezone }).format(new Date(r.dueAt)).toUpperCase()}` : 'DUE SOON'}
                    </span>
                    {r.title}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {lastMessage && (
          <Card>
            <CardHeading>From your coach</CardHeading>
            <div className="mt-3 rounded-[12px] border-l-[3px] border-space-violet bg-space-violet-bg p-4">
              <p className="text-[12px] font-semibold text-space-violet-text">{lastMessage.author}</p>
              <p className="mt-1 line-clamp-3 text-sm text-content-body">{lastMessage.body}</p>
            </div>
          </Card>
        )}
      </div>

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
                  <button
                    onClick={() => onToggle(a.id, a.isDone)}
                    aria-label={a.isDone ? 'Mark not done' : 'Mark done'}
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${a.isDone ? 'border-enviro-green bg-enviro-green' : 'border-content-faint hover:border-enviro-green'}`}
                  >
                    {a.isDone && <Check className="h-3 w-3 text-white" />}
                  </button>
                  <span className={a.isDone ? 'text-content-faint line-through' : 'text-content-body'}>{a.title}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeading>Workshop progress</CardHeading>
          <p className="mt-2 font-display text-[32px] font-bold text-space-violet">{pct}%</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-pill bg-[#EEF0F7]">
            <div className="h-full rounded-pill bg-space-violet" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-[12.5px] text-content-muted">
            {props.sessions.filter((s) => s.status === 'completed').length} sessions ·{' '}
            {resources.filter((r) => r.itemCount > 0 && r.completedCount >= r.itemCount).length} training · {done} actions done
          </p>
        </Card>
      </div>
    </div>
  )
}

// ── Sessions ────────────────────────────────────────────────────────────────
function SessionsPane({ sessions, tz, isCoach, workshopId }: { sessions: SessionRow[]; tz: string; isCoach: boolean; workshopId: string }) {
  const now = Date.now()
  const sorted = [...sessions].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
  const nextId = sorted.find((s) => s.status === 'scheduled' && new Date(s.start).getTime() > now)?.id

  if (sessions.length === 0) {
    return (
      <Card>
        <p className="text-sm text-content-muted">No sessions scheduled yet.</p>
        {!isCoach && (
          <Link href={`/community/coaching/${workshopId}/access`} className="mt-2 inline-block text-[13px] font-semibold text-primary hover:underline">
            Request a session →
          </Link>
        )}
      </Card>
    )
  }
  return (
    <Card>
      <div className="mb-3 flex justify-end">
        <a
          href={`/api/community/coaching/${workshopId}/calendar`}
          className="inline-flex items-center gap-1.5 rounded-[9px] bg-primary-soft px-3.5 py-2 text-[13px] font-semibold text-primary hover:bg-primary/15"
        >
          <CalendarPlus className="h-4 w-4" /> Sync all to Google Calendar
        </a>
      </div>
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
                    {s.title ?? 'Coaching session'}
                    <span className={`rounded-pill px-2 py-0.5 text-[10px] font-bold tracking-[0.04em] ${badge.cls}`}>{badge.text}</span>
                  </p>
                  <p className="text-[13px] text-content-secondary">{t.dateShort} · {t.timeLine}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {s.recordingStatus === 'available' ? (
                  <MaterialDownloadButton endpoint={`/api/community/sessions/${s.id}/recording`} title={`${s.title ?? 'session'}-recording`} label="Watch recording" />
                ) : isNext ? (
                  <JoinButton sessionId={s.id} scheduledStart={s.start} isHost={isCoach} />
                ) : !isPast ? (
                  <a
                    href={gcalUrl(s.title ?? 'Coaching session', s.start, s.end)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-[9px] bg-primary-soft px-3.5 py-2 text-[13px] font-semibold text-primary hover:bg-primary/15"
                  >
                    <CalendarPlus className="h-4 w-4" /> Add to Calendar
                  </a>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
      {!isCoach && (
        <div className="mt-3 border-t border-line-light pt-3 text-right">
          <Link href={`/community/coaching/${workshopId}/access`} className="text-[13px] font-semibold text-primary hover:underline">
            Request a different time →
          </Link>
        </div>
      )}
    </Card>
  )
}

// ── Training ────────────────────────────────────────────────────────────────
function TrainingPane({ resources, fileResources, tz }: { resources: ResourceRow[]; fileResources: FileResourceRow[]; tz: string }) {
  if (resources.length === 0 && fileResources.length === 0) {
    return <Card><p className="text-sm text-content-muted">No training assigned yet. Your coach will add courses and resources here.</p></Card>
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
                  <Tag mandatory={r.isMandatory} />
                </p>
                <p className="text-[12.5px] text-content-muted">
                  Course · {r.completedCount}/{r.itemCount} complete
                  {r.dueAt && <> · due {fmtDay(r.dueAt, tz)}</>}
                </p>
              </div>
            </div>
            <span className="text-[13px] font-semibold text-primary">
              {done ? 'Done' : r.canAccess ? (r.completedCount > 0 ? 'Resume →' : 'Open →') : 'Locked'}
            </span>
          </div>
        )
        return <div key={r.moduleId}>{r.canAccess ? <Link href={`/community/training/${r.moduleId}`}>{inner}</Link> : inner}</div>
      })}
      {fileResources.map((r) => {
        const isLink = (r.fileType ?? '').toLowerCase() === 'link' || (r.fileType ?? '').toLowerCase() === 'url'
        return (
          <div key={r.resourceId} className="flex items-center justify-between gap-3 rounded-card border border-line bg-white p-4">
            <div className="flex items-center gap-3">
              <IconTile kind={isLink ? 'link' : 'file'} />
              <div>
                <p className="flex items-center gap-2 font-medium text-ink">
                  {r.title}
                  <Tag mandatory={r.isMandatory} />
                </p>
                <p className="text-[12.5px] text-content-muted">
                  {isLink ? 'Link' : r.fileType ? r.fileType.toUpperCase() : 'File'}
                  {r.dueAt && <> · due {fmtDay(r.dueAt, tz)}</>}
                </p>
              </div>
            </div>
            <ResourceDownloadButton resourceId={r.resourceId} title={r.title} />
          </div>
        )
      })}
      <p className="pt-1 text-[12.5px] text-content-faint">Yours to access in perpetuity.</p>
    </div>
  )
}

// ── Recordings ──────────────────────────────────────────────────────────────
function RecordingsPane({ recordings, tz }: { recordings: { id: string; title: string | null; start: string; end: string | null }[]; tz: string }) {
  if (recordings.length === 0) {
    return (
      <Card>
        <p className="text-sm text-content-muted">No recordings yet. Every live session is recorded automatically and appears here.</p>
      </Card>
    )
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {recordings.map((s) => (
          <div key={s.id} className="overflow-hidden rounded-card border border-line bg-white">
            <div
              className="relative flex h-[120px] items-center justify-center"
              style={{ background: 'radial-gradient(130% 150% at 80% -20%, #36306F, #181D44 60%, #0E1330)' }}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white">
                <Play className="h-5 w-5" />
              </span>
              <span className="absolute bottom-2 right-2 rounded bg-black/55 px-1.5 py-0.5 text-[10.5px] font-semibold text-white">
                {durationLabel(s.start, s.end)}
              </span>
            </div>
            <div className="p-4">
              <p className="truncate font-medium text-ink">{s.title ?? 'Session recording'}</p>
              <p className="mt-0.5 text-[12.5px] text-content-muted">{fmtDay(s.start, tz)}</p>
              <div className="mt-3">
                <MaterialDownloadButton endpoint={`/api/community/sessions/${s.id}/recording`} title={`${s.title ?? 'session'}-recording`} label="Watch" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[12.5px] text-content-faint">Every live session is recorded automatically. Yours forever.</p>
    </div>
  )
}

// ── Actions ─────────────────────────────────────────────────────────────────
function ActionsPane({ actions, onToggle, tz, coachName }: { actions: ActionRow[]; onToggle: (id: string, current: boolean) => void; tz: string; coachName: string | null }) {
  const todo = actions.filter((a) => !a.isDone).length
  const done = actions.length - todo

  if (actions.length === 0) return <Card><p className="text-sm text-content-muted">No actions assigned yet.</p></Card>
  return (
    <Card>
      <div className="mb-3 flex gap-4 text-[13px] font-semibold">
        <span className="text-pathway-amber">{todo} to do</span>
        <span className="text-enviro-green-text">{done} done</span>
      </div>
      <ul className="divide-y divide-line-light">
        {actions.map((a) => (
          <li key={a.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <button
              onClick={() => onToggle(a.id, a.isDone)}
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
                  <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> due {fmtDay(a.dueDate, tz)}</span>
                )}
                {coachName && <span>from {coachName}</span>}
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
function fmtDay(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso))
}
function durationLabel(start: string, end: string | null): string {
  const s = new Date(start).getTime()
  const e = end ? new Date(end).getTime() : s + 60 * 60_000
  const mins = Math.max(1, Math.round((e - s) / 60_000))
  return mins >= 60 && mins % 60 === 0 ? `${mins / 60} hr` : `${mins} min`
}
function gcalUrl(title: string, start: string, end: string | null): string {
  const fmt = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const s = new Date(start)
  const e = end ? new Date(end) : new Date(s.getTime() + 90 * 60_000)
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${fmt(s.toISOString())}/${fmt(e.toISOString())}`,
    details: 'Stellr coaching session',
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
function Tag({ mandatory }: { mandatory: boolean }) {
  return (
    <span className={`rounded-pill px-2 py-0.5 text-[10px] font-bold ${mandatory ? 'bg-space-violet-chip text-space-violet-text' : 'bg-surface text-content-muted'}`}>
      {mandatory ? 'MANDATORY' : 'OPTIONAL'}
    </span>
  )
}
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
  const dots = [[12, 30], [28, 64], [60, 20], [85, 48], [70, 78], [40, 18], [92, 70], [18, 80], [50, 50], [78, 14]]
  return (
    <div className="pointer-events-none absolute inset-0">
      {dots.map(([x, y], i) => (
        <span key={i} className="absolute h-[2px] w-[2px] rounded-full bg-white/40" style={{ left: `${x}%`, top: `${y}%` }} />
      ))}
    </div>
  )
}
