'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Mail, MessageSquare, Send } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { formatDateShort } from '@/lib/utils'
import type { TrainableObject, EventTracking, TrackStatus } from '@/lib/training-admin'

// Event tracking: searchable Object picker, age-bracket filter, outstanding-only
// chip, completion summary, bulk Email/SMS reminders, and the participant table.

import { ObjectPicker } from './ObjectPicker'

const STATUS: Record<TrackStatus, { label: string; bg: string; color: string }> = {
  complete: { label: 'Complete', bg: '#E7F7F1', color: '#158463' },
  in_progress: { label: 'In progress', bg: '#EAF0FE', color: '#2C53C6' },
  overdue: { label: 'Overdue', bg: '#FCEBE8', color: '#C0392B' },
  not_started: { label: 'Not started', bg: '#F0F2F8', color: '#8A91AB' },
}

const BRACKETS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'high_school', label: 'High school' },
  { value: 'college', label: 'College' },
  { value: 'adult', label: 'Adults' },
]
const BRACKET_LABEL: Record<string, string> = { high_school: 'High school', college: 'College', adult: 'Adults' }

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-2xl border border-brand-border bg-white p-5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted-soft">{label}</p>
      <p className="mt-2 text-3xl font-bold" style={{ color }}>{value}</p>
    </div>
  )
}

export function EventTrackingTab({
  objects,
  initialObjectRef,
  initialOutstanding,
}: {
  objects: TrainableObject[]
  initialObjectRef: string | null
  initialOutstanding: boolean
}) {
  const [objectRef, setObjectRef] = useState<string | null>(initialObjectRef ?? objects[0]?.ref ?? null)
  const [bracket, setBracket] = useState('all')
  const [outstanding, setOutstanding] = useState(initialOutstanding)
  const [data, setData] = useState<EventTracking | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sent, setSent] = useState(false)

  const selectedObject = objects.find((o) => o.ref === objectRef)
  const objectLabel = selectedObject?.label ?? 'this event'

  const load = useCallback(async () => {
    if (!objectRef) return
    setLoading(true)
    setSelected(new Set())
    try {
      const objectType = objects.find((o) => o.ref === objectRef)?.type ?? 'competition'
      const qs = new URLSearchParams({ objectType, objectRef, bracket, outstanding: outstanding ? '1' : '0' })
      const res = await fetch(`/api/admin/training/tracking?${qs}`)
      setData(res.ok ? await res.json() : null)
    } finally {
      setLoading(false)
    }
  }, [objectRef, bracket, outstanding, objects])

  useEffect(() => {
    load()
  }, [load])

  const rows = data?.rows ?? []
  const incompleteRows = rows.filter((r) => r.status !== 'complete')
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const allIncompleteSelected = incompleteRows.length > 0 && incompleteRows.every((r) => selected.has(r.memberId))
  const toggleAll = () =>
    setSelected(allIncompleteSelected ? new Set() : new Set(incompleteRows.map((r) => r.memberId)))

  const sendReminders = async () => {
    if (selected.size === 0) return
    setSent(false)
    const res = await fetch('/api/admin/training/bulk-notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberIds: [...selected], objectLabel }),
    })
    if (res.ok) {
      setSent(true)
      setSelected(new Set())
      setTimeout(() => setSent(false), 2500)
    }
  }

  if (objects.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-brand-border bg-white p-6 text-sm text-brand-muted-soft">
        No Objects have training assigned yet. Assign a course to an Object in the Course builder.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      {/* Object picker + age bracket */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <ObjectPicker objects={objects} value={objectRef} onChange={setObjectRef} />
        <div className="inline-flex items-center rounded-xl border border-brand-border bg-white p-1" role="tablist" aria-label="Age bracket">
          {BRACKETS.map((b) => {
            const active = bracket === b.value
            return (
              <button
                key={b.value}
                role="tab"
                aria-selected={active}
                onClick={() => setBracket(b.value)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                  active ? 'bg-brand-blue-dark text-white' : 'text-brand-muted-soft hover:text-brand-muted'
                }`}
              >
                {b.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Outstanding chip */}
      {outstanding && (
        <button
          onClick={() => setOutstanding(false)}
          className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold"
          style={{ background: '#FCEBE8', color: '#C0392B' }}
        >
          Outstanding only · overdue mandatory
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryCard label="Complete" value={data?.summary.complete ?? 0} color="#158463" />
        <SummaryCard label="In progress" value={data?.summary.in_progress ?? 0} color="#2C53C6" />
        <SummaryCard label="Not started" value={data?.summary.not_started ?? 0} color="#8A91AB" />
        <SummaryCard label="Overdue" value={data?.summary.overdue ?? 0} color="#C0392B" />
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl bg-brand-blue-dark px-5 py-4 text-white sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm font-semibold">{selected.size} incomplete selected</span>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-white/70">Notify via</span>
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold" style={{ background: '#3C6DF6', color: '#fff' }}>
              <Mail className="h-3.5 w-3.5" /> In-app + Email
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white/50" style={{ background: 'rgba(255,255,255,.08)' }} title="SMS reminders are coming soon">
              <MessageSquare className="h-3.5 w-3.5" /> SMS · soon
            </span>
            <button
              onClick={sendReminders}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-bright"
            >
              <Send className="h-4 w-4" /> {sent ? 'Sent' : 'Send reminder to selected'}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-brand-border bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-brand-hairline text-[11px] uppercase tracking-wide text-brand-muted-soft">
              <th className="px-4 py-3">
                <input
                  type="checkbox"
                  aria-label="Select all incomplete"
                  checked={allIncompleteSelected}
                  onChange={toggleAll}
                  disabled={incompleteRows.length === 0}
                />
              </th>
              <th className="px-3 py-3 font-semibold">Participant</th>
              <th className="px-3 py-3 font-semibold">Age bracket</th>
              <th className="px-3 py-3 font-semibold">Group</th>
              <th className="px-3 py-3 font-semibold">Mandatory training</th>
              <th className="px-3 py-3 font-semibold">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-brand-muted-soft">Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-brand-muted-soft">
                {data && data.courses.length === 0 ? 'No mandatory training is assigned to this Object.' : 'No participants found.'}
              </td></tr>
            )}
            {!loading && rows.map((r) => {
              const s = STATUS[r.status]
              const selectable = r.status !== 'complete'
              return (
                <tr key={r.memberId} className="border-b border-brand-hairline last:border-0">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.name}`}
                      checked={selected.has(r.memberId)}
                      onChange={() => toggle(r.memberId)}
                      disabled={!selectable}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={r.name} id={r.memberId} size="sm" />
                      <span className="font-medium text-brand-blue-dark">{r.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-brand-muted">{r.ageBracket ? BRACKET_LABEL[r.ageBracket] ?? r.ageBracket : '—'}</td>
                  <td className="px-3 py-3 text-brand-muted">{r.group}</td>
                  <td className="px-3 py-3">
                    <span className="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ background: s.bg, color: s.color }}>
                      {s.label}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-brand-muted-soft">{r.lastActivity ? formatDateShort(r.lastActivity) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
