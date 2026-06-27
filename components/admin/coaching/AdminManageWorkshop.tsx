'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Calendar, UserPlus, ShieldCheck, Trash2 } from 'lucide-react'
import { ChatPanel } from '@/components/community/ChatPanel'
import { JoinButton } from '@/components/community/JoinButton'
import { MaterialDownloadButton } from '@/components/community/MaterialDownloadButton'
import { MemberSearchField, type PickedPerson } from '@/components/community/mentoring/MemberSearchField'
import { ModalShell, ScheduleAllModal, ScheduleOneModal, EditSessionModal } from '@/components/community/mentoring/ScheduleModals'
import { CohortResourceAttacher, type AttachedFileResource } from '@/components/community/mentoring/CohortResourceAttacher'
import { formatSessionTime, TIMEZONES } from '@/lib/mentoring-format'

type Tab = 'member' | 'schedule' | 'resources' | 'chat' | 'settings'

interface WorkshopMeta {
  id: string
  name: string
  timezone: string
  plannedSessions: number
  coachMemberId: string | null
  coachName: string | null
  memberId: string | null
  memberName: string | null
  memberEmail: string | null
  memberStatus: 'active' | 'invited' | null
  freeForTierIds: string[]
  oneOffPriceCents: number | null
}
interface SessionRow { id: string; title: string | null; start: string; end: string | null; status: string; recordingStatus: string }
interface ResourceRow { moduleId: string; title: string; isMandatory: boolean; dueAt: string | null }
type ModuleOpt = { id: string; title: string }

const ADMIN_SEARCH = '/api/admin/members/search'
const MANAGE_ENDPOINT = '/api/community/coaching/manage'

export function AdminManageWorkshop(props: {
  workshop: WorkshopMeta
  sessions: SessionRow[]
  resources: ResourceRow[]
  fileResources: AttachedFileResource[]
  recordings: { id: string; title: string | null; start: string }[]
  modules: ModuleOpt[]
  tiers: { id: string; name: string }[]
  channelId: string
  selfMemberId: string
  selfName?: string
  flaggedCount: number
}) {
  const { workshop } = props
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('member')
  const [modal, setModal] = useState<null | 'scheduleAll' | 'scheduleOne' | 'setMember' | 'reassignCoach'>(null)
  const [editSession, setEditSession] = useState<SessionRow | null>(null)
  const now = Date.now()
  const remaining = Math.max(0, workshop.plannedSessions - props.sessions.length)

  const manage = async (payload: Record<string, unknown>) => {
    const res = await fetch(MANAGE_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workshopId: workshop.id, ...payload }) })
    if (res.ok) { setModal(null); router.refresh(); return true }
    return false
  }
  const admin = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/admin/community/coaching', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (res.ok) { setModal(null); router.refresh(); return true }
    return false
  }

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'member', label: 'Member' },
    { key: 'schedule', label: 'Schedule' },
    { key: 'resources', label: 'Resources' },
    { key: 'chat', label: 'Chat', count: props.flaggedCount || undefined },
    { key: 'settings', label: 'Settings' },
  ]

  return (
    <div className="space-y-5">
      <div className="rounded-panel px-7 py-6 text-white" style={{ background: 'radial-gradient(130% 150% at 88% -30%, #36306F, #181D44 48%, #0E1330)' }}>
        <p className="text-[12.5px] text-hero-dim">
          <Link href="/admin/academy/coaching" className="hover:text-white">Workshops</Link>
          <span className="mx-1.5 text-white/30">/</span>
          <span className="text-hero-lead">{workshop.memberName ?? workshop.name}</span>
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] font-display text-sm font-bold text-white" style={{ background: 'linear-gradient(150deg,#7C5CFC,#5B3FE0)' }}>{workshop.name.charAt(0)}</span>
            <h1 className="font-display text-[26px] font-bold tracking-[-0.02em]">{workshop.name}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setModal('reassignCoach')} className="rounded-[9px] border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10">Reassign coach</button>
            <button onClick={() => setTab('settings')} className="rounded-[9px] border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10">Settings</button>
          </div>
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

      {/* Member (single) */}
      {tab === 'member' && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-[16px] font-bold text-ink">Member</h2>
            <button onClick={() => setModal('setMember')} className="inline-flex items-center gap-1.5 rounded-[9px] bg-primary-soft px-3.5 py-2 text-[13px] font-semibold text-primary hover:bg-primary/15">
              <UserPlus className="h-4 w-4" /> {workshop.memberId ? 'Replace member' : 'Invite member'}
            </button>
          </div>
          {!workshop.memberId ? (
            <p className="text-sm text-content-muted">No member yet. Invite one — they join after accepting.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-[12px] font-semibold text-white">{(workshop.memberName ?? 'M').charAt(0).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{workshop.memberName}</p>
                <p className="text-[12.5px] text-content-muted">{workshop.memberEmail}</p>
              </div>
              <span className={`rounded-pill px-2.5 py-0.5 text-[11px] font-semibold ${workshop.memberStatus === 'active' ? 'bg-enviro-green-bg text-enviro-green-text' : 'bg-pathway-amber-bg text-[#C2722A]'}`}>{workshop.memberStatus === 'active' ? 'Active' : 'Invited'}</span>
              <button onClick={() => admin({ action: 'removeMember', workshopId: workshop.id, memberId: workshop.memberId })} className="text-[13px] font-medium text-danger hover:underline">Remove</button>
            </div>
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
              const t = formatSessionTime(s.start, s.end, workshop.timezone)
              const isPast = new Date(s.start).getTime() < now || s.status === 'completed'
              return (
                <li key={s.id} className="flex items-center justify-between gap-3 py-3.5 first:pt-0">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 flex-col items-center justify-center rounded-[10px] bg-surface"><span className="font-display text-[15px] font-bold leading-none text-ink">{t.day}</span><span className="text-[10px] uppercase text-content-muted">{t.month}</span></div>
                    <div><p className="font-medium text-ink">{s.title ?? 'Coaching session'}</p><p className="text-[13px] text-content-secondary">{t.timeLine}</p></div>
                  </div>
                  <div className="flex items-center gap-2">
                    {s.recordingStatus === 'available' ? (
                      <MaterialDownloadButton endpoint={`/api/community/sessions/${s.id}/recording`} title="recording" label="Recording" />
                    ) : !isPast ? (
                      <>
                        <JoinButton sessionId={s.id} scheduledStart={s.start} isHost />
                        <button onClick={() => setEditSession(s)} className="rounded-[9px] border border-line px-3 py-1.5 text-[13px] font-semibold text-content-secondary hover:border-space-violet hover:text-space-violet">Edit</button>
                      </>
                    ) : (
                      <span className="text-[13px] text-content-faint">—</span>
                    )}
                  </div>
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
      {tab === 'resources' && (
        <div className="space-y-4">
          <AdminResources resources={props.resources} modules={props.modules} tz={workshop.timezone} manage={manage} />
          <CohortResourceAttacher cohortId={workshop.id} attached={props.fileResources} tz={workshop.timezone} endpoint={MANAGE_ENDPOINT} />
          <RecordingsList recordings={props.recordings} tz={workshop.timezone} />
        </div>
      )}

      {/* Chat */}
      {tab === 'chat' && <ChatPanel channelId={props.channelId} selfMemberId={props.selfMemberId} selfName={props.selfName} title={workshop.name} canModerate />}

      {/* Settings */}
      {tab === 'settings' && <AdminSettings workshop={workshop} tiers={props.tiers} admin={admin} />}

      {modal === 'scheduleAll' && <ScheduleAllModal tz={workshop.timezone} count={remaining} onClose={() => setModal(null)} onSubmit={manage} />}
      {modal === 'scheduleOne' && <ScheduleOneModal tz={workshop.timezone} onClose={() => setModal(null)} onSubmit={manage} />}
      {editSession && <EditSessionModal tz={workshop.timezone} session={editSession} onClose={() => setEditSession(null)} onSubmit={async (p) => { const ok = await manage(p); if (ok) setEditSession(null); return ok }} />}
      {modal === 'setMember' && (
        <SetMemberModal existing={!!workshop.memberId} onClose={() => setModal(null)} onSubmit={(memberId) => admin({ action: 'setMember', workshopId: workshop.id, memberId })} />
      )}
      {modal === 'reassignCoach' && (
        <ReassignCoachModal currentCoach={workshop.coachName} onClose={() => setModal(null)} onSubmit={(newCoachId) => admin({ action: 'reassignCoach', workshopId: workshop.id, newCoachId })} />
      )}
    </div>
  )
}

function RecordingsList({ recordings, tz }: { recordings: { id: string; title: string | null; start: string }[]; tz: string }) {
  return (
    <Card>
      <h2 className="font-display text-[16px] font-bold text-ink">Recordings</h2>
      {recordings.length === 0 ? (
        <p className="mt-2 text-sm text-content-muted">No recordings yet. Every live session is recorded automatically and appears here.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line-light">
          {recordings.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <span className="flex items-center gap-2 font-medium text-ink">
                {s.title ?? 'Session recording'}
                <span className="rounded-pill bg-surface px-2 py-0.5 text-[10px] font-bold text-content-muted">AUTO</span>
              </span>
              <div className="flex items-center gap-3">
                <span className="text-[12.5px] text-content-muted">{new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: tz }).format(new Date(s.start))}</span>
                <MaterialDownloadButton endpoint={`/api/community/sessions/${s.id}/recording`} title={`${s.title ?? 'session'}-recording`} label="Watch" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function ReassignCoachModal({ currentCoach, onClose, onSubmit }: { currentCoach: string | null; onClose: () => void; onSubmit: (newCoachId: string) => Promise<boolean> }) {
  const [picked, setPicked] = useState<PickedPerson[]>([])
  const [busy, setBusy] = useState(false)
  return (
    <ModalShell title="Reassign coach" onClose={onClose}>
      <p className="text-[13px] text-content-muted">
        Current coach: <strong>{currentCoach ?? 'none'}</strong>. The new coach gains full management access to this workshop.
      </p>
      <MemberSearchField endpoint={ADMIN_SEARCH} selected={picked} onChange={(n) => setPicked(n.slice(-1))} placeholder="Search for a coach…" />
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-[9px] px-4 py-2.5 text-sm font-medium text-content-secondary hover:bg-surface">Cancel</button>
        <button onClick={async () => { if (picked[0]) { setBusy(true); if (!(await onSubmit(picked[0].id))) setBusy(false) } }} disabled={busy || !picked[0]} className="rounded-[9px] bg-space-violet px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#5B3FE0] disabled:opacity-50">{busy ? 'Reassigning…' : 'Reassign coach'}</button>
      </div>
    </ModalShell>
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
      <p className="mt-3 text-[12.5px] text-content-faint">Session recordings are added here automatically (AUTO).</p>
    </Card>
  )
}

function AdminSettings({ workshop, tiers, admin }: { workshop: WorkshopMeta; tiers: { id: string; name: string }[]; admin: (p: Record<string, unknown>) => Promise<boolean> }) {
  const [name, setName] = useState(workshop.name)
  const [coach, setCoach] = useState<PickedPerson[]>([])
  const [timezone, setTimezone] = useState(workshop.timezone)
  const [confirm, setConfirm] = useState('')
  const router = useRouter()
  const freeTierNames = tiers.filter((t) => workshop.freeForTierIds.includes(t.id)).map((t) => t.name)

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="font-display text-[16px] font-bold text-ink">Workshop settings</h2>
        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold text-content-secondary">Workshop name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-[9px] border border-line px-3.5 py-2.5 text-sm outline-none focus:border-space-violet" />
          </div>
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold text-content-secondary">Coach</label>
            <p className="mb-1.5 text-[12.5px] text-content-muted">Current: {workshop.coachName ?? 'none'}. Choose a new coach to reassign (gains full management access).</p>
            <MemberSearchField endpoint={ADMIN_SEARCH} selected={coach} onChange={(n) => setCoach(n.slice(-1))} placeholder="Search for a coach…" />
          </div>
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold text-content-secondary">Time zone</label>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full rounded-[9px] border border-line bg-white px-3.5 py-2.5 text-sm outline-none focus:border-space-violet">
              {TIMEZONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <p className="mt-1 text-[12px] text-content-faint">Shown on every session time; applies to new sessions you schedule.</p>
          </div>
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold text-content-secondary">Access</label>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-enviro-green-bg px-2.5 py-1 text-[12.5px] font-medium text-enviro-green-text">
                <ShieldCheck className="h-3.5 w-3.5" /> {freeTierNames.length ? `Free · ${freeTierNames.join(', ')}` : 'Eligible tiers'}
              </span>
              <Link href="/admin/academy/coaching/access" className="text-[13px] font-semibold text-primary hover:underline">Manage access →</Link>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={async () => {
                await admin({ action: 'updateWorkshop', workshopId: workshop.id, name, timezone })
                if (coach[0]) await admin({ action: 'reassignCoach', workshopId: workshop.id, newCoachId: coach[0].id })
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
              <p className="font-semibold text-ink">Archive workshop</p>
              <p className="text-[13px] text-content-muted">Closes the chat and all video calls. Recordings, files and chat history stay available.</p>
            </div>
            <button onClick={() => admin({ action: 'archive', workshopId: workshop.id })} className="rounded-[9px] border border-pathway-amber px-4 py-2 text-sm font-semibold text-[#C2722A] hover:bg-pathway-amber-bg">Archive workshop</button>
          </div>
          <div className="rounded-[12px] border border-danger/30 bg-danger/5 p-4">
            <p className="font-semibold text-danger">Delete workshop</p>
            <p className="text-[13px] text-content-muted">Permanently removes the workshop and all associated data — recordings, uploaded files and chat history. Cannot be undone.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={`Type "${workshop.name}" to confirm`} className="flex-1 rounded-[9px] border border-line px-3 py-2 text-sm outline-none focus:border-danger" />
              <button
                onClick={async () => { if ((await admin({ action: 'delete', workshopId: workshop.id }))) router.push('/admin/academy/coaching') }}
                disabled={confirm !== workshop.name}
                className="inline-flex items-center gap-1.5 rounded-[9px] bg-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" /> Delete workshop
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SetMemberModal({ existing, onClose, onSubmit }: { existing: boolean; onClose: () => void; onSubmit: (memberId: string) => Promise<boolean> }) {
  const [picked, setPicked] = useState<PickedPerson[]>([])
  const [busy, setBusy] = useState(false)
  return (
    <ModalShell title={existing ? 'Replace member' : 'Invite member'} onClose={onClose}>
      <p className="text-[13px] text-content-muted">
        One-on-one — pick a single member. They receive an in-app notification and email, and join only after accepting.
        {existing && ' Replacing removes the current member.'}
      </p>
      <MemberSearchField endpoint={ADMIN_SEARCH} selected={picked} onChange={(n) => setPicked(n.slice(-1))} placeholder="Search for a member…" />
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-[9px] px-4 py-2.5 text-sm font-medium text-content-secondary hover:bg-surface">Cancel</button>
        <button onClick={async () => { if (picked[0]) { setBusy(true); if (!(await onSubmit(picked[0].id))) setBusy(false) } }} disabled={busy || !picked[0]} className="rounded-[9px] bg-space-violet px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#5B3FE0] disabled:opacity-50">{busy ? 'Sending…' : 'Send invite'}</button>
      </div>
    </ModalShell>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-card border border-line bg-white p-5">{children}</div>
}
