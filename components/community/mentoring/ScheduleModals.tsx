'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { zonedToUtcIso, TIMEZONES } from '@/lib/mentoring-format'

export const inputCls = 'w-full rounded-[9px] border border-line px-3.5 py-2.5 text-sm outline-none focus:border-space-violet'

export function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(14,19,48,.55)' }} onClick={onClose}>
      <div className="w-full max-w-[460px] rounded-[18px] bg-white p-6 shadow-[0_30px_70px_-20px_rgba(0,0,0,.5)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h2 className="font-display text-[20px] font-bold text-ink">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-content-faint hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-4 space-y-4">{children}</div>
      </div>
    </div>
  )
}

export function ModalField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[12.5px] font-semibold text-content-secondary">{label}</label>
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
