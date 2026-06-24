'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { X, Plus, Calendar, UserPlus } from 'lucide-react'
import { ChatPanel } from '@/components/community/ChatPanel'
import { JoinButton } from '@/components/community/JoinButton'
import { MaterialDownloadButton } from '@/components/community/MaterialDownloadButton'
import { MemberSearchField, type PickedPerson } from '@/components/community/mentoring/MemberSearchField'
import { ModalShell, ModalField, inputCls, ScheduleAllModal, ScheduleOneModal } from '@/components/community/mentoring/ScheduleModals'
import { formatSessionTime, themeTile, type CohortTheme } from '@/lib/mentoring-format'
import type { RosterMember, CohortActionGroup } from '@/lib/mentoring'

type Tab = 'members' | 'schedule' | 'resources' | 'actions' | 'chat'

interface CohortMeta {
  id: string
  name: string
  theme: CohortTheme
  timezone: string
  plannedSessions: number
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
}
type ModuleOpt = { id: string; title: string }

export function ManageCohort(props: {
  cohort: CohortMeta
  roster: RosterMember[]
  sessions: SessionRow[]
  resources: ResourceRow[]
  actionGroups: CohortActionGroup[]
  modules: ModuleOpt[]
  channelId: string
  selfMemberId: string
  selfName?: string
  flaggedCount: number
}) {
  const { cohort } = props
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('members')
  const [modal, setModal] = useState<null | 'scheduleAll' | 'scheduleOne' | 'assignAction' | 'invite'>(null)
  const tile = themeTile(cohort.theme)

  const now = Date.now()
  const upcoming = [...props.sessions]
    .filter((s) => s.status === 'scheduled' && new Date(s.start).getTime() > now)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
  const nextSession = upcoming[0] ?? null
  const remaining = Math.max(0, cohort.plannedSessions - props.sessions.length)

  const post = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/community/mentoring/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cohortId: cohort.id, ...payload }),
    })
    if (res.ok) {
      setModal(null)
      router.refresh()
      return true
    }
    return false
  }

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'members', label: 'Members', count: props.roster.length || undefined },
    { key: 'schedule', label: 'Schedule' },
    { key: 'resources', label: 'Resources' },
    { key: 'actions', label: 'Actions', count: props.actionGroups.length || undefined },
    { key: 'chat', label: 'Chat', count: props.flaggedCount || undefined },
  ]

  return (
    <div className="mx-auto max-w-content space-y-6">
      {/* Mini-hero */}
      <div className="rounded-panel px-7 py-6 text-white" style={{ background: 'radial-gradient(130% 150% at 88% -30%, #36306F, #181D44 48%, #0E1330)' }}>
        <p className="text-[12.5px] text-hero-dim">
          <Link href="/community/mentoring/manage" className="hover:text-white">Your cohorts</Link>
          <span className="mx-1.5 text-white/30">/</span>
          <span className="text-hero-lead">{cohort.name}</span>
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-[28px] font-bold tracking-[-0.02em]">{cohort.name}</h1>
            <span className="rounded-pill bg-primary-soft px-2.5 py-0.5 text-[11px] font-bold text-primary">MENTOR</span>
          </div>
          <div className="flex items-center gap-2">
            {nextSession && <JoinButton sessionId={nextSession.id} scheduledStart={nextSession.start} isHost />}
            <button onClick={() => setModal('scheduleOne')} className="rounded-[9px] border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10">
              Schedule session
            </button>
          </div>
        </div>

        <nav className="mt-5 flex gap-6 border-b border-white/10">
          {TABS.map((t) => {
            const active = tab === t.key
            return (
              <button key={t.key} onClick={() => setTab(t.key)} className={`relative -mb-px pb-3 text-sm transition-colors ${active ? 'font-bold text-white' : 'font-medium text-hero-dim hover:text-hero-lead'}`}>
                {t.label}
                {t.count ? <span className="ml-1.5 text-[11px] text-star-gold">{t.count}</span> : null}
                {active && <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-t bg-star-gold" />}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Panes */}
      {tab === 'members' && (
        <MembersPane roster={props.roster} onInvite={() => setModal('invite')} />
      )}
      {tab === 'schedule' && (
        <SchedulePane
          sessions={props.sessions}
          tz={cohort.timezone}
          remaining={remaining}
          onScheduleAll={() => setModal('scheduleAll')}
          onScheduleOne={() => setModal('scheduleOne')}
        />
      )}
      {tab === 'resources' && (
        <ResourcesPane resources={props.resources} modules={props.modules} tz={cohort.timezone} post={post} />
      )}
      {tab === 'actions' && (
        <ActionsPane groups={props.actionGroups} tz={cohort.timezone} onAssign={() => setModal('assignAction')} />
      )}
      {tab === 'chat' && (
        <ChatPanel channelId={props.channelId} selfMemberId={props.selfMemberId} selfName={props.selfName} title={cohort.name} canModerate />
      )}

      {/* Modals */}
      {modal === 'scheduleAll' && (
        <ScheduleAllModal tz={cohort.timezone} count={remaining} onClose={() => setModal(null)} onSubmit={post} />
      )}
      {modal === 'scheduleOne' && (
        <ScheduleOneModal tz={cohort.timezone} onClose={() => setModal(null)} onSubmit={post} />
      )}
      {modal === 'assignAction' && (
        <AssignActionModal roster={props.roster} modules={props.modules} onClose={() => setModal(null)} onSubmit={post} />
      )}
      {modal === 'invite' && (
        <InviteModal onClose={() => setModal(null)} onSubmit={post} />
      )}
    </div>
  )
}

// ── Members ─────────────────────────────────────────────────────────────────
function MembersPane({ roster, onInvite }: { roster: RosterMember[]; onInvite: () => void }) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[16px] font-bold text-ink">Members</h2>
        <button onClick={onInvite} className="inline-flex items-center gap-1.5 rounded-[9px] bg-primary-soft px-3.5 py-2 text-[13px] font-semibold text-primary hover:bg-primary/15">
          <UserPlus className="h-4 w-4" /> Invite members
        </button>
      </div>
      {roster.length === 0 ? (
        <p className="text-sm text-content-muted">No members yet. Invite members to get started.</p>
      ) : (
        <ul className="divide-y divide-line-light">
          {roster.map((m) => {
            const pct = m.actionsTotal > 0 ? Math.round((m.actionsDone / m.actionsTotal) * 100) : 0
            return (
              <li key={m.memberId} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-[12px] font-semibold text-white">{m.name.charAt(0).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{m.name}</p>
                  <p className="text-[12.5px] text-content-muted">{m.email}</p>
                </div>
                <div className="flex w-40 items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-pill bg-[#EEF0F7]"><div className="h-full rounded-pill bg-space-violet" style={{ width: `${pct}%` }} /></div>
                  <span className="text-[12px] text-content-muted">{m.actionsDone}/{m.actionsTotal}</span>
                </div>
                <span className={`rounded-pill px-2.5 py-0.5 text-[11px] font-semibold ${m.status === 'active' ? 'bg-enviro-green-bg text-enviro-green-text' : 'bg-pathway-amber-bg text-[#C2722A]'}`}>
                  {m.status === 'active' ? 'Active' : 'Invited'}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

// ── Schedule ────────────────────────────────────────────────────────────────
function SchedulePane({
  sessions,
  tz,
  remaining,
  onScheduleAll,
  onScheduleOne,
}: {
  sessions: SessionRow[]
  tz: string
  remaining: number
  onScheduleAll: () => void
  onScheduleOne: () => void
}) {
  const now = Date.now()
  const sorted = [...sessions].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
  const nextId = sorted.find((s) => s.status === 'scheduled' && new Date(s.start).getTime() > now)?.id

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[16px] font-bold text-ink">Schedule</h2>
        {remaining > 0 && (
          <button onClick={onScheduleAll} className="rounded-[9px] bg-space-violet px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#5B3FE0]">
            Schedule all sessions
          </button>
        )}
      </div>
      <ul className="divide-y divide-line-light">
        {sorted.map((s) => {
          const t = formatSessionTime(s.start, s.end, tz)
          const isPast = new Date(s.start).getTime() < now || s.status === 'completed'
          const isNext = s.id === nextId
          const badge = isNext ? { text: 'NEXT', cls: 'bg-space-violet-chip text-space-violet-text' } : isPast ? { text: 'COMPLETED', cls: 'bg-surface text-content-muted' } : { text: 'SCHEDULED', cls: 'bg-primary-soft text-primary' }
          return (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-[10px] bg-surface">
                  <span className="font-display text-[15px] font-bold leading-none text-ink">{t.day}</span>
                  <span className="text-[10px] uppercase text-content-muted">{t.month}</span>
                </div>
                <div>
                  <p className="flex items-center gap-2 font-medium text-ink">
                    {s.title ?? 'Mentoring session'}
                    <span className={`rounded-pill px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>{badge.text}</span>
                  </p>
                  <p className="text-[13px] text-content-secondary">{t.timeLine}</p>
                </div>
              </div>
              <div>
                {s.recordingStatus === 'available' ? (
                  <MaterialDownloadButton endpoint={`/api/community/sessions/${s.id}/recording`} title={`${s.title ?? 'session'}-recording`} label="Recording" />
                ) : isNext ? (
                  <JoinButton sessionId={s.id} scheduledStart={s.start} isHost />
                ) : (
                  <span className="text-[13px] text-content-faint">{isPast ? '—' : 'Scheduled'}</span>
                )}
              </div>
            </li>
          )
        })}
        {Array.from({ length: remaining }).map((_, i) => (
          <li key={`empty-${i}`} className="flex items-center justify-between gap-3 py-3.5 first:pt-0">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-dashed border-line text-content-faint">
                <Calendar className="h-4 w-4" />
              </div>
              <div>
                <p className="font-medium text-content-secondary">Session {sessions.length + i + 1}</p>
                <p className="text-[13px] text-content-faint">Not scheduled yet</p>
              </div>
            </div>
            <button onClick={onScheduleOne} className="rounded-[9px] border border-line px-3.5 py-2 text-[13px] font-semibold text-content-secondary hover:border-space-violet hover:text-space-violet">
              Schedule
            </button>
          </li>
        ))}
      </ul>
      {sessions.length === 0 && remaining === 0 && <p className="text-sm text-content-muted">No sessions planned.</p>}
    </Card>
  )
}

// ── Resources ───────────────────────────────────────────────────────────────
function ResourcesPane({
  resources,
  modules,
  tz,
  post,
}: {
  resources: ResourceRow[]
  modules: ModuleOpt[]
  tz: string
  post: (p: Record<string, unknown>) => Promise<boolean>
}) {
  const [adding, setAdding] = useState(false)
  const [moduleId, setModuleId] = useState('')
  const linkedIds = new Set(resources.map((r) => r.moduleId))
  const available = modules.filter((m) => !linkedIds.has(m.id))

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[16px] font-bold text-ink">Resources</h2>
        <button onClick={() => setAdding((v) => !v)} className="rounded-[9px] bg-primary-soft px-3.5 py-2 text-[13px] font-semibold text-primary hover:bg-primary/15">
          Assign material
        </button>
      </div>

      {adding && (
        <div className="mb-4 flex items-center gap-2 rounded-[12px] bg-surface p-3">
          <select value={moduleId} onChange={(e) => setModuleId(e.target.value)} className="flex-1 rounded-[9px] border border-line bg-white px-3 py-2 text-sm">
            <option value="">Choose a course…</option>
            {available.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
          <button
            onClick={async () => { if (moduleId && (await post({ action: 'linkTraining', moduleId, mandatory: false }))) { setModuleId(''); setAdding(false) } }}
            disabled={!moduleId}
            className="rounded-[9px] bg-space-violet px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Add
          </button>
        </div>
      )}

      {resources.length === 0 ? (
        <p className="text-sm text-content-muted">No material assigned. Session recordings are added here automatically.</p>
      ) : (
        <ul className="divide-y divide-line-light">
          {resources.map((r) => (
            <ResourceManageRow key={r.moduleId} r={r} tz={tz} post={post} />
          ))}
        </ul>
      )}
      <p className="mt-3 text-[12.5px] text-content-faint">Session recordings are added here automatically.</p>
    </Card>
  )
}

function ResourceManageRow({ r, tz, post }: { r: ResourceRow; tz: string; post: (p: Record<string, unknown>) => Promise<boolean> }) {
  const [mandatory, setMandatory] = useState(r.isMandatory)
  const [due, setDue] = useState(r.dueAt ? r.dueAt.slice(0, 10) : '')

  const save = (nextMandatory: boolean, nextDue: string) =>
    post({ action: 'linkTraining', moduleId: r.moduleId, mandatory: nextMandatory, dueAt: nextDue ? new Date(nextDue).toISOString() : null })

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <span className="font-medium text-ink">{r.title}</span>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-[13px] text-content-secondary">
          <input
            type="checkbox"
            checked={mandatory}
            onChange={(e) => { setMandatory(e.target.checked); save(e.target.checked, due) }}
            className="h-4 w-4 accent-space-violet"
          />
          Mandatory
        </label>
        {mandatory && (
          <input
            type="date"
            value={due}
            onChange={(e) => { setDue(e.target.value); save(mandatory, e.target.value) }}
            className="rounded-[9px] border border-line px-2.5 py-1.5 text-[13px] text-content"
          />
        )}
        {!mandatory && due && <span className="text-[12px] text-content-faint">due {new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: tz }).format(new Date(due))}</span>}
        <button onClick={() => post({ action: 'unlinkTraining', moduleId: r.moduleId })} className="text-[13px] font-medium text-danger hover:underline">Remove</button>
      </div>
    </li>
  )
}

// ── Actions ─────────────────────────────────────────────────────────────────
function ActionsPane({ groups, tz, onAssign }: { groups: CohortActionGroup[]; tz: string; onAssign: () => void }) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[16px] font-bold text-ink">Actions</h2>
        <button onClick={onAssign} className="inline-flex items-center gap-1.5 rounded-[9px] bg-space-violet px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#5B3FE0]">
          <Plus className="h-4 w-4" /> Assign action
        </button>
      </div>
      {groups.length === 0 ? (
        <p className="text-sm text-content-muted">No actions assigned yet.</p>
      ) : (
        <ul className="divide-y divide-line-light">
          {groups.map((g) => {
            const pct = g.totalCount > 0 ? Math.round((g.doneCount / g.totalCount) * 100) : 0
            return (
              <li key={g.batchId} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium text-ink">
                    {g.title}
                    <span className={`rounded-pill px-2 py-0.5 text-[10px] font-bold ${g.kind === 'training' ? 'bg-space-violet-chip text-space-violet-text' : 'bg-primary-soft text-primary'}`}>{g.kind === 'training' ? 'TRAINING' : 'TASK'}</span>
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-content-muted">
                    {g.assigneeLabel}
                    {g.dueDate && <> · due {new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: tz }).format(new Date(g.dueDate))}</>}
                    {g.remindBeforeHours ? ' · reminder on' : ''}
                  </p>
                </div>
                <div className="flex w-36 items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-pill bg-[#EEF0F7]"><div className="h-full rounded-pill bg-enviro-green" style={{ width: `${pct}%` }} /></div>
                  <span className="text-[12px] font-semibold text-content-muted">{g.doneCount}/{g.totalCount}</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

// ── Modals ──────────────────────────────────────────────────────────────────
function AssignActionModal({ roster, modules, onClose, onSubmit }: { roster: RosterMember[]; modules: ModuleOpt[]; onClose: () => void; onSubmit: (p: Record<string, unknown>) => Promise<boolean> }) {
  const [type, setType] = useState<'task' | 'resource'>('task')
  const [taskText, setTaskText] = useState('')
  const [moduleId, setModuleId] = useState('')
  const [assignTo, setAssignTo] = useState<'all' | string>('all')
  const [due, setDue] = useState('')
  const [remind, setRemind] = useState(false)
  const [busy, setBusy] = useState(false)
  const activeMembers = roster.filter((r) => r.status === 'active')

  const submit = async () => {
    const title = type === 'task' ? taskText.trim() : modules.find((m) => m.id === moduleId)?.title ?? ''
    if (!title) return
    setBusy(true)
    const ok = await onSubmit({
      action: 'assignAction',
      title,
      trainingModuleId: type === 'resource' ? moduleId : null,
      memberIds: assignTo === 'all' ? [] : [assignTo],
      dueDate: due ? new Date(due).toISOString() : null,
      remind,
    })
    if (!ok) setBusy(false)
  }

  return (
    <ModalShell title="Assign an action" onClose={onClose}>
      <ModalField label="Action type">
        <div className="inline-flex rounded-[9px] border border-line p-0.5">
          {[{ v: 'task', l: 'Free-text task' }, { v: 'resource', l: 'Complete a resource' }].map((o) => (
            <button key={o.v} onClick={() => setType(o.v as 'task' | 'resource')} className={`rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium ${type === o.v ? 'bg-space-violet text-white' : 'text-content-secondary'}`}>{o.l}</button>
          ))}
        </div>
      </ModalField>
      {type === 'task' ? (
        <ModalField label="Task"><textarea value={taskText} onChange={(e) => setTaskText(e.target.value)} rows={3} placeholder="What should the mentee do?" className={inputCls} /></ModalField>
      ) : (
        <ModalField label="Resource"><select value={moduleId} onChange={(e) => setModuleId(e.target.value)} className={inputCls}><option value="">Choose a course…</option>{modules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select></ModalField>
      )}
      <ModalField label="Assign to">
        <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className={inputCls}>
          <option value="all">All mentees</option>
          {activeMembers.map((m) => <option key={m.memberId} value={m.memberId}>{m.name}</option>)}
        </select>
      </ModalField>
      <ModalField label="Due date"><input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={inputCls} /></ModalField>
      <label className="flex items-center gap-2.5 text-sm text-content-body">
        <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} className="h-4 w-4 accent-space-violet" />
        Send a reminder 24h before
      </label>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-[9px] px-4 py-2.5 text-sm font-medium text-content-secondary hover:bg-surface">Cancel</button>
        <button onClick={submit} disabled={busy} className="rounded-[9px] bg-space-violet px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#5B3FE0] disabled:opacity-50">{busy ? 'Assigning…' : 'Assign action'}</button>
      </div>
    </ModalShell>
  )
}

function InviteModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (p: Record<string, unknown>) => Promise<boolean> }) {
  const [picked, setPicked] = useState<PickedPerson[]>([])
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (picked.length === 0) return
    setBusy(true)
    const ok = await onSubmit({ action: 'invite', memberIds: picked.map((p) => p.id) })
    if (!ok) setBusy(false)
  }
  return (
    <ModalShell title="Invite members" onClose={onClose}>
      <p className="text-[13px] text-content-muted">
        Invited members receive an in-app notification and an email. They join only after accepting — not added automatically.
      </p>
      <MemberSearchField selected={picked} onChange={setPicked} />
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-[9px] px-4 py-2.5 text-sm font-medium text-content-secondary hover:bg-surface">Cancel</button>
        <button onClick={submit} disabled={busy || picked.length === 0} className="rounded-[9px] bg-space-violet px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#5B3FE0] disabled:opacity-50">{busy ? 'Sending…' : 'Send invites'}</button>
      </div>
    </ModalShell>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-card border border-line bg-white p-5">{children}</div>
}
