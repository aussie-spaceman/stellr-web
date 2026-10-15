'use client'

import { isValidElement, useId, useState } from 'react'
import { Dialog, Field } from '@stellr/web-ui'
import { zonedToUtcIso, TIMEZONES } from '@/lib/mentoring-format'

function localParts(iso: string, tz: string): { date: string; time: string } {
  const d = new Date(iso)
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  return { date, time }
}

export const inputCls = 'min-h-11 w-full rounded-[9px] border border-line-strong px-3.5 py-2.5 text-input mouse:text-sm outline-none focus:border-space-violet'

// Every "ModalShell" in coaching and mentoring is the shared Dialog: a bottom
// sheet on phones, capped to the screen, focus held inside.
export function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Dialog open onClose={onClose} title={title} size="md" bodyClassName="space-y-4 pt-1">
      {children}
    </Dialog>
  )
}

const CONTROL_TAGS = new Set(['input', 'select', 'textarea'])

// A labelled field. A single input, select or textarea gets a real <label for>;
// anything else (a group of choices) is a labelled group.
export function ModalField({ label, children }: { label: string; children: React.ReactNode }) {
  const labelId = useId()
  if (isValidElement(children) && typeof children.type === 'string' && CONTROL_TAGS.has(children.type)) {
    return (
      <Field label={label} labelSize="small">
        {children}
      </Field>
    )
  }
  return (
    <div role="group" aria-labelledby={labelId}>
      <span id={labelId} className="mb-1.5 block text-xs font-semibold text-content-secondary">{label}</span>
      {children}
    </div>
  )
}

type Submit = (p: Record<string, unknown>) => Promise<boolean>

export function ScheduleAllModal({ tz: cohortTz, count, onClose, onSubmit }: { tz: string; count: number; onClose: () => void; onSubmit: Submit }) {
  const [date, setDate] = useState('')
  const [time, setTime] = useState('18:00')
  const [duration, setDuration] = useState(90)
  const [tz, setTz] = useState(cohortTz)
  const [repeat, setRepeat] = useState<'weekly' | 'fortnightly'>('weekly')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!date) return
    setBusy(true)
    const ok = await onSubmit({ action: 'scheduleSeries', startIso: zonedToUtcIso(date, time, tz), count, intervalDays: repeat === 'weekly' ? 7 : 14, durationMin: duration })
    if (!ok) setBusy(false)
  }

  return (
    <ModalShell title="Schedule all sessions" onClose={onClose}>
      <ModalField label="Start date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></ModalField>
      <div className="grid grid-cols-2 gap-3">
        <ModalField label="Start time"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} /></ModalField>
        <ModalField label="Duration (min)"><input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value) || 60)} className={inputCls} /></ModalField>
      </div>
      <ModalField label="Time zone">
        <select value={tz} onChange={(e) => setTz(e.target.value)} className={inputCls}>{TIMEZONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
      </ModalField>
      <ModalField label="Repeat">
        <select value={repeat} onChange={(e) => setRepeat(e.target.value as 'weekly' | 'fortnightly')} className={inputCls}>
          <option value="weekly">Weekly</option>
          <option value="fortnightly">Fortnightly</option>
        </select>
      </ModalField>
      <p className="rounded-[10px] bg-surface px-3.5 py-2.5 text-[12.5px] text-content-muted">Google Calendar invites go to every member; each session is auto-recorded to Resources.</p>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-[9px] px-4 py-2.5 text-sm font-medium text-content-secondary hover:bg-surface">Cancel</button>
        <button onClick={submit} disabled={busy || !date} className="rounded-[9px] bg-space-violet px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#5B3FE0] disabled:opacity-50">{busy ? 'Scheduling…' : `Schedule ${count} session${count === 1 ? '' : 's'}`}</button>
      </div>
    </ModalShell>
  )
}

export function EditSessionModal({
  tz: cohortTz,
  session,
  onClose,
  onSubmit,
}: {
  tz: string
  session: { id: string; title: string | null; start: string; end: string | null }
  onClose: () => void
  onSubmit: Submit
}) {
  const init = localParts(session.start, cohortTz)
  const initialDur = session.end
    ? Math.max(15, Math.round((new Date(session.end).getTime() - new Date(session.start).getTime()) / 60_000))
    : 90
  const [title, setTitle] = useState(session.title ?? '')
  const [date, setDate] = useState(init.date)
  const [time, setTime] = useState(init.time)
  const [duration, setDuration] = useState(initialDur)
  const [tz, setTz] = useState(cohortTz)
  const [busy, setBusy] = useState<null | 'save' | 'cancel'>(null)

  const save = async () => {
    if (!date) return
    setBusy('save')
    const ok = await onSubmit({ action: 'rescheduleSession', sessionId: session.id, startIso: zonedToUtcIso(date, time, tz), durationMin: duration, title: title || undefined })
    if (!ok) setBusy(null)
  }
  const cancel = async () => {
    setBusy('cancel')
    const ok = await onSubmit({ action: 'cancelSession', sessionId: session.id })
    if (!ok) setBusy(null)
  }

  return (
    <ModalShell title="Edit session" onClose={onClose}>
      <ModalField label="Session title"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Coaching session" className={inputCls} /></ModalField>
      <ModalField label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></ModalField>
      <div className="grid grid-cols-2 gap-3">
        <ModalField label="Start time"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} /></ModalField>
        <ModalField label="Duration (min)"><input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value) || 60)} className={inputCls} /></ModalField>
      </div>
      <ModalField label="Time zone">
        <select value={tz} onChange={(e) => setTz(e.target.value)} className={inputCls}>{TIMEZONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
      </ModalField>
      <div className="flex items-center justify-between gap-2">
        <button onClick={cancel} disabled={busy !== null} className="rounded-[9px] px-3 py-2.5 text-sm font-medium text-danger hover:bg-danger/5 disabled:opacity-50">{busy === 'cancel' ? 'Cancelling…' : 'Cancel session'}</button>
        <div className="flex gap-2">
          <button onClick={onClose} className="rounded-[9px] px-4 py-2.5 text-sm font-medium text-content-secondary hover:bg-surface">Close</button>
          <button onClick={save} disabled={busy !== null || !date} className="rounded-[9px] bg-space-violet px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#5B3FE0] disabled:opacity-50">{busy === 'save' ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </ModalShell>
  )
}

export function ScheduleOneModal({ tz: cohortTz, onClose, onSubmit }: { tz: string; onClose: () => void; onSubmit: Submit }) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('18:00')
  const [duration, setDuration] = useState(90)
  const [tz, setTz] = useState(cohortTz)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!date) return
    setBusy(true)
    const ok = await onSubmit({ action: 'scheduleSeries', count: 1, startIso: zonedToUtcIso(date, time, tz), intervalDays: 7, durationMin: duration, title: title || undefined })
    if (!ok) setBusy(false)
  }

  return (
    <ModalShell title="Schedule session" onClose={onClose}>
      <ModalField label="Session title"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Mission planning" className={inputCls} /></ModalField>
      <ModalField label="Start date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></ModalField>
      <div className="grid grid-cols-2 gap-3">
        <ModalField label="Start time"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} /></ModalField>
        <ModalField label="Duration (min)"><input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value) || 60)} className={inputCls} /></ModalField>
      </div>
      <ModalField label="Time zone">
        <select value={tz} onChange={(e) => setTz(e.target.value)} className={inputCls}>{TIMEZONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
      </ModalField>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-[9px] px-4 py-2.5 text-sm font-medium text-content-secondary hover:bg-surface">Cancel</button>
        <button onClick={submit} disabled={busy || !date} className="rounded-[9px] bg-space-violet px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#5B3FE0] disabled:opacity-50">{busy ? 'Scheduling…' : 'Schedule'}</button>
      </div>
    </ModalShell>
  )
}
