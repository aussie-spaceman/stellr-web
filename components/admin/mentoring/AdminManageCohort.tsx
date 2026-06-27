'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Calendar, UserPlus, ShieldCheck, Trash2 } from 'lucide-react'
import { ChatPanel } from '@/components/community/ChatPanel'
import { JoinButton } from '@/components/community/JoinButton'
import { MaterialDownloadButton } from '@/components/community/MaterialDownloadButton'
import { MemberSearchField, type PickedPerson } from '@/components/community/mentoring/MemberSearchField'
import { ModalShell, ModalField, inputCls, ScheduleAllModal, ScheduleOneModal } from '@/components/community/mentoring/ScheduleModals'
import { formatSessionTime, themeTile, type CohortTheme } from '@/lib/mentoring-format'
import type { RosterMember } from '@/lib/mentoring'
import Link from 'next/link'

type Tab = 'members' | 'schedule' | 'resources' | 'chat' | 'settings'
interface CohortMeta {
  id: string
  name: string
  theme: CohortTheme
  timezone: string
  plannedSessions: number
  mentorMemberId: string | null
  mentorName: string | null
  freeForTierIds: string[]
  oneOffPriceCents: number | null
}
interface SessionRow { id: string; title: string | null; start: string; end: string | null; status: string; recordingStatus: string }
interface ResourceRow { moduleId: string; title: string; isMandatory: boolean; dueAt: string | null }
type ModuleOpt = { id: string; title: string }

const ADMIN_SEARCH = '/api/admin/members/search'

export function AdminManageCohort(props: {
  cohort: CohortMeta
  roster: RosterMember[]
  sessions: SessionRow[]
  resources: ResourceRow[]
  modules: ModuleOpt[]
  tiers: { id: string; name: string }[]
  channelId: string
  selfMemberId: string
  selfName?: string
  flaggedCount: number
}) {
  const { cohort } = props
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('members')
  const [modal, setModal] = useState<null | 'scheduleAll' | 'scheduleOne' | 'invite' | 'makeMentor'>(null)
  const [mentorTarget, setMentorTarget] = useState<RosterMember | null>(null)
  const tile = themeTile(cohort.theme)
  const now = Date.now()
  const remaining = Math.max(0, cohort.plannedSessions - props.sessions.length)

  const manage = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/community/mentoring/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cohortId: cohort.id, ...payload }) })
    if (res.ok) { setModal(null); router.refresh(); return true }
    return false
  }
  const admin = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/admin/community/mentoring', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (res.ok) { setModal(null); setMentorTarget(null); router.refresh(); return true }
    return false
  }

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'members', label: 'Members', count: props.roster.length || undefined },
    { key: 'schedule', label: 'Schedule' },
    { key: 'resources', label: 'Resources' },
    { key: 'chat', label: 'Group chat', count: props.flaggedCount || undefined },
    { key: 'settings', label: 'Settings' },
  ]

  return (
    <div className="space-y-5">
      {/* Mini-hero */}
      <div className="rounded-panel px-7 py-6 text-white" style={{ background: 'radial-gradient(130% 150% at 88% -30%, #36306F, #181D44 48%, #0E1330)' }}>
        <p className="text-[12.5px] text-hero-dim">Cohorts <span className="mx-1.5 text-white/30">/</span><span className="text-hero-lead">{cohort.name}</span></p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] font-display text-sm font-bold text-white" style={{ background: tile.gradient }}>{cohort.name.charAt(0)}</span>
            <h1 className="font-display text-[26px] font-bold tracking-[-0.02em]">{cohort.name}</h1>
          </div>
          <button onClick={() => setTab('settings')} className="rounded-[9px] border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10">Settings</button>
        </div>
        <nav className="mt-5 flex gap-6 border-b border-white/10">
          {TABS.map((t) => {
            const active = tab === t.key
            return (
              <button key={t.key} onClick={() => setTab(t.key)} className={`relative -mb-px pb-3 text-sm transition-colors ${active ? 'font-bold text-white' : 'font-medium text-hero-dim hover:text-hero-lead'}`}>
                {t.label}{t.count ? <span className="ml-1.5 text-[11px] text-star-gold">{t.count}</span> : null}
                {active && <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-t bg-star-gold" />}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Members */}
      {tab === 'members' && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-[16px] font-bold text-ink">Members</h2>
            <button onClick={() => setModal('invite')} className="inline-flex items-center gap-1.5 rounded-[9px] bg-primary-soft px-3.5 py-2 text-[13px] font-semibold text-primary hover:bg-primary/15"><UserPlus className="h-4 w-4" /> Invite member</button>
          </div>
          {props.roster.length === 0 ? (
            <p className="text-sm text-content-muted">No members yet.</p>
          ) : (
            <ul className="divide-y divide-line-light">
              {props.roster.map((m) => (
                <li key={m.memberId} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-[12px] font-semibold text-white">{m.name.charAt(0).toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{m.name}</p>
                    <p className="text-[12.5px] text-content-muted">{m.email}</p>
                  </div>
                  <span className={`rounded-pill px-2.5 py-0.5 text-[11px] font-semibold ${m.status === 'active' ? 'bg-enviro-green-bg text-enviro-green-text' : 'bg-pathway-amber-bg text-[#C2722A]'}`}>{m.status === 'active' ? 'Active' : 'Invited'}</span>
                  <div className="flex items-center gap-2">
                    {m.status === 'invited' ? (
                      <button onClick={() => admin({ action: 'resendInvites', cohortId: cohort.id })} className="text-[13px] font-medium text-primary hover:underline">Resend invite</button>
                    ) : (
                      <button onClick={() => { setMentorTarget(m); setModal('makeMentor') }} className="text-[13px] font-medium text-space-violet hover:underline">Make mentor</button>
                    )}
                    <button onClick={() => admin({ action: 'removeMember', cohortId: cohort.id, memberId: m.memberId })} className="text-[13px] font-medium text-danger hover:underline">Remove</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* Schedule */}
      {tab === 'schedule' && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-[16px] font-bold text-ink">Schedule</h2>
            {remaining > 0 && <button onClick={() => setModal('scheduleAll')} className="rounded-[9px] bg-space-violet px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#5B3FE0]">Schedule all sessions</button>}
          </div>
          <ul className="divide-y divide-line-light">
            {[...props.sessions].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()).map((s) => {
              const t = formatSessionTime(s.start, s.end, cohort.timezone)
              const isPast = new Date(s.start).getTime() < now || s.status === 'completed'
              return (
                <li key={s.id} className="flex items-center justify-between gap-3 py-3.5 first:pt-0">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 flex-col items-center justify-center rounded-[10px] bg-surface"><span className="font-display text-[15px] font-bold leading-none text-ink">{t.day}</span><span className="text-[10px] uppercase text-content-muted">{t.month}</span></div>
                    <div><p className="font-medium text-ink">{s.title ?? 'Mentoring session'}</p><p className="text-[13px] text-content-secondary">{t.timeLine}</p></div>
                  </div>
                  {s.recordingStatus === 'available' ? <MaterialDownloadButton endpoint={`/api/community/sessions/${s.id}/recording`} title="recording" label="Recording" /> : !isPast ? <JoinButton sessionId={s.id} scheduledStart={s.start} isHost /> : <span className="text-[13px] text-content-faint">—</span>}
                </li>
              )
            })}
            {Array.from({ length: remaining }).map((_, i) => (
              <li key={`e-${i}`} className="flex items-center justify-between gap-3 py-3.5 first:pt-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-dashed border-line text-content-faint"><Calendar className="h-4 w-4" /></div>
                  <div><p className="font-medium text-content-secondary">Session {props.sessions.length + i + 1}</p><p className="text-[13px] text-content-faint">Not scheduled yet</p></div>
                </div>
                <button onClick={() => setModal('scheduleOne')} className="rounded-[9px] border border-line px-3.5 py-2 text-[13px] font-semibold text-content-secondary hover:border-space-violet hover:text-space-violet">Schedule</button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Resources */}
      {tab === 'resources' && <AdminResources resources={props.resources} modules={props.modules} tz={cohort.timezone} manage={manage} />}

      {/* Group chat */}
      {tab === 'chat' && <ChatPanel channelId={props.channelId} selfMemberId={props.selfMemberId} selfName={props.selfName} title={cohort.name} canModerate />}

      {/* Settings */}
      {tab === 'settings' && <AdminSettings cohort={cohort} tiers={props.tiers} admin={admin} />}

      {/* Modals */}
      {modal === 'scheduleAll' && <ScheduleAllModal tz={cohort.timezone} count={remaining} onClose={() => setModal(null)} onSubmit={manage} />}
      {modal === 'scheduleOne' && <ScheduleOneModal tz={cohort.timezone} onClose={() => setModal(null)} onSubmit={manage} />}
      {modal === 'invite' && <InviteModal cohortId={cohort.id} onClose={() => setModal(null)} onSubmit={admin} />}
      {modal === 'makeMentor' && mentorTarget && (
        <ModalShell title="Make mentor" onClose={() => { setModal(null); setMentorTarget(null) }}>
          <p className="text-sm text-content-body">
            Make <strong>{mentorTarget.name}</strong> a mentor? They&apos;re granted the mentor role <strong>across the platform</strong> — assignable to any cohort, and can manage cohorts, schedule sessions, assign resources and actions, and host calls.
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => { setModal(null); setMentorTarget(null) }} className="rounded-[9px] px-4 py-2.5 text-sm font-medium text-content-secondary hover:bg-surface">Cancel</button>
            <button onClick={() => admin({ action: 'makeMentor', memberId: mentorTarget.memberId })} className="rounded-[9px] bg-space-violet px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#5B3FE0]">Grant mentor role</button>
          </div>
        </ModalShell>
      )}
    </div>
  )
}

function AdminResources({ resources, modules, tz, manage }: { resources: ResourceRow[]; modules: ModuleOpt[]; tz: string; manage: (p: Record<string, unknown>) => Promise<boolean> }) {
  const [moduleId, setModuleId] = useState('')
  const linked = new Set(resources.map((r) => r.moduleId))
  const available = modules.filter((m) => !linked.has(m.id))
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[16px] font-bold text-ink">Resources</h2>
        <div className="flex items-center gap-2">
          <select value={moduleId} onChange={(e) => setModuleId(e.target.value)} className="rounded-[9px] border border-line bg-white px-3 py-2 text-sm">
            <option value="">Add a course…</option>
            {available.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
          <button onClick={async () => { if (moduleId && (await manage({ action: 'linkTraining', moduleId, mandatory: false }))) setModuleId('') }} disabled={!moduleId} className="rounded-[9px] bg-space-violet px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Add</button>
        </div>
      </div>
      {resources.length === 0 ? (
        <p className="text-sm text-content-muted">No material assigned. Session recordings are added automatically.</p>
      ) : (
        <ul className="divide-y divide-line-light">
          {resources.map((r) => (
            <li key={r.moduleId} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <span className="flex items-center gap-2 font-medium text-ink">
                {r.title}
                <span className={`rounded-pill px-2 py-0.5 text-[10px] font-bold ${r.isMandatory ? 'bg-space-violet-chip text-space-violet-text' : 'bg-surface text-content-muted'}`}>{r.isMandatory ? 'MANDATORY' : 'OPTIONAL'}</span>
                {r.isMandatory && r.dueAt && <span className="rounded-pill bg-pathway-amber-bg px-2 py-0.5 text-[10px] font-bold text-[#C2722A]">due {new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: tz }).format(new Date(r.dueAt))}</span>}
              </span>
              <div className="flex items-center gap-3">
                <button onClick={() => manage({ action: 'linkTraining', moduleId: r.moduleId, mandatory: !r.isMandatory, dueAt: r.dueAt })} className="text-[13px] font-medium text-space-violet hover:underline">{r.isMandatory ? 'Make optional' : 'Make mandatory'}</button>
                <button onClick={() => manage({ action: 'unlinkTraining', moduleId: r.moduleId })} className="text-[13px] font-medium text-danger hover:underline">Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function AdminSettings({ cohort, tiers, admin }: { cohort: CohortMeta; tiers: { id: string; name: string }[]; admin: (p: Record<string, unknown>) => Promise<boolean> }) {
  const [name, setName] = useState(cohort.name)
  const [mentor, setMentor] = useState<PickedPerson[]>([])
  const [confirm, setConfirm] = useState('')
  const router = useRouter()
  const freeTierNames = tiers.filter((t) => cohort.freeForTierIds.includes(t.id)).map((t) => t.name)

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="font-display text-[16px] font-bold text-ink">Cohort settings</h2>
        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold text-content-secondary">Cohort name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold text-content-secondary">Mentor</label>
            <p className="mb-1.5 text-[12.5px] text-content-muted">Current: {cohort.mentorName ?? 'none'}. Choose a new mentor to reassign (gains full management access).</p>
            <MemberSearchField endpoint={ADMIN_SEARCH} selected={mentor} onChange={(n) => setMentor(n.slice(-1))} placeholder="Search for a mentor…" />
          </div>
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold text-content-secondary">Access</label>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-enviro-green-bg px-2.5 py-1 text-[12.5px] font-medium text-enviro-green-text">
                <ShieldCheck className="h-3.5 w-3.5" /> {freeTierNames.length ? `Free · ${freeTierNames.join(', ')}` : 'No free tiers'}
              </span>
              <Link href="/admin/academy/mentoring/membership" className="text-[13px] font-semibold text-primary hover:underline">Manage access →</Link>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={async () => {
                await admin({ action: 'updateCohort', cohortId: cohort.id, name })
                if (mentor[0]) await admin({ action: 'reassignMentor', cohortId: cohort.id, newMentorId: mentor[0].id })
                router.refresh()
              }}
              className="rounded-[9px] bg-space-violet px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#5B3FE0]"
            >
              Save changes
            </button>
          </div>
        </div>
      </Card>

      {/* Danger zone */}
      <div className="rounded-card border border-danger/30 bg-white p-5">
        <h2 className="font-display text-[16px] font-bold text-danger">Danger zone</h2>
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-pathway-amber-bg/40 p-4">
            <div>
              <p className="font-semibold text-ink">Archive cohort</p>
              <p className="text-[13px] text-content-muted">Closes the chat and all video calls. Recordings, files and chat history stay available.</p>
            </div>
            <button onClick={() => admin({ action: 'archive', cohortId: cohort.id })} className="rounded-[9px] border border-pathway-amber px-4 py-2 text-sm font-semibold text-[#C2722A] hover:bg-pathway-amber-bg">Archive cohort</button>
          </div>
          <div className="rounded-[12px] border border-danger/30 bg-danger/5 p-4">
            <p className="font-semibold text-danger">Delete cohort</p>
            <p className="text-[13px] text-content-muted">Permanently removes the cohort and all associated data — recordings, uploaded files and chat history. Cannot be undone.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={`Type "${cohort.name}" to confirm`} className="flex-1 rounded-[9px] border border-line px-3 py-2 text-sm outline-none focus:border-danger" />
              <button
                onClick={async () => { if ((await admin({ action: 'delete', cohortId: cohort.id }))) router.push('/admin/academy/mentoring') }}
                disabled={confirm !== cohort.name}
                className="inline-flex items-center gap-1.5 rounded-[9px] bg-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" /> Delete cohort
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function InviteModal({ cohortId, onClose, onSubmit }: { cohortId: string; onClose: () => void; onSubmit: (p: Record<string, unknown>) => Promise<boolean> }) {
  const [picked, setPicked] = useState<PickedPerson[]>([])
  const [busy, setBusy] = useState(false)
  return (
    <ModalShell title="Invite members" onClose={onClose}>
      <p className="text-[13px] text-content-muted">Invited members receive an in-app notification and an email. They join only after accepting — not added automatically.</p>
      <MemberSearchField endpoint={ADMIN_SEARCH} selected={picked} onChange={setPicked} />
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-[9px] px-4 py-2.5 text-sm font-medium text-content-secondary hover:bg-surface">Cancel</button>
        <button onClick={async () => { if (picked.length) { setBusy(true); if (!(await onSubmit({ action: 'invite', cohortId, memberIds: picked.map((p) => p.id) }))) setBusy(false) } }} disabled={busy || picked.length === 0} className="rounded-[9px] bg-space-violet px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#5B3FE0] disabled:opacity-50">{busy ? 'Sending…' : 'Send invites'}</button>
      </div>
    </ModalShell>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-card border border-line bg-white p-5">{children}</div>
}
