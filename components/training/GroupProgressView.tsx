'use client'

import { useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Send } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import type { GroupProgress, GroupCellStatus } from '@/lib/training-portal'

// Teacher's group-completion matrix. Object filter re-queries server-side (?obj=);
// group filter is a client-side row filter. Nudge / Remind call the group-nudge API.

const CELL: Record<GroupCellStatus, { label: string; bg: string; color: string }> = {
  complete: { label: 'Complete', bg: '#E7F7F1', color: '#158463' },
  in_progress: { label: 'In progress', bg: '#EAF0FE', color: '#2C53C6' },
  overdue: { label: 'Overdue', bg: '#FCEBE8', color: '#C0392B' },
  not_started: { label: 'Not started', bg: '#F0F2F8', color: '#8A91AB' },
}

function StatusPill({ status }: { status: GroupCellStatus }) {
  const s = CELL[status]
  return (
    <span
      className="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  )
}

function SummaryCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-2xl border border-brand-border bg-white p-5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted-soft">{label}</p>
      <p className="mt-2 text-3xl font-bold" style={{ color: color ?? '#13183A' }}>{value}</p>
    </div>
  )
}

export function GroupProgressView({ data }: { data: GroupProgress }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<Set<string>>(new Set())

  const objectLabel = data.objects.find((o) => o.ref === data.selectedRef)?.label ?? 'your event'

  const setObject = (ref: string) => {
    const next = new URLSearchParams(params.toString())
    next.set('obj', ref)
    router.push(`${pathname}?${next.toString()}`)
  }

  const rows = data.students.filter((s) => groupFilter === 'all' || s.group === groupFilter)

  const isComplete = (memberId: string) =>
    data.courses.every((c) => data.students.find((s) => s.memberId === memberId)?.statusByCourse[c.moduleId] === 'complete')

  const nudge = async (memberIds: string[], key: string) => {
    if (memberIds.length === 0 || !data.selectedRef) return
    setBusy(key)
    try {
      const res = await fetch('/api/community/training/group-nudge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberIds, objectRef: data.selectedRef, objectLabel }),
      })
      if (res.ok) setDone((prev) => new Set(prev).add(key))
    } finally {
      setBusy(null)
    }
  }

  const incompleteIds = rows.filter((s) => !isComplete(s.memberId)).map((s) => s.memberId)

  if (data.objects.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-brand-border bg-white p-6 text-sm text-brand-muted-soft">
        You don&apos;t have any events with a group to monitor yet.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      {/* Filters + remind */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={data.selectedRef ?? ''}
            onChange={(e) => setObject(e.target.value)}
            aria-label="Object filter"
            className="rounded-xl border border-brand-border bg-white px-3 py-2 text-sm font-medium text-brand-blue-dark focus:border-brand-blue focus:outline-none"
          >
            {data.objects.map((o) => (
              <option key={o.ref} value={o.ref}>{o.label}</option>
            ))}
          </select>
          {data.groups.length > 1 && (
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              aria-label="Group filter"
              className="rounded-xl border border-brand-border bg-white px-3 py-2 text-sm font-medium text-brand-blue-dark focus:border-brand-blue focus:outline-none"
            >
              <option value="all">All groups</option>
              {data.groups.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          )}
        </div>
        <button
          onClick={() => nudge(incompleteIds, 'all')}
          disabled={incompleteIds.length === 0 || busy === 'all'}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-bright disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
          {done.has('all') ? 'Reminders sent' : busy === 'all' ? 'Sending…' : 'Remind incomplete'}
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard label="Students in group" value={data.summary.total} />
        <SummaryCard label="Fully compliant" value={data.summary.compliant} color="#158463" />
        <SummaryCard label="Overdue · at risk" value={data.summary.atRisk} color="#C0392B" />
      </div>

      {/* Matrix */}
      {data.courses.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-brand-border bg-white p-6 text-sm text-brand-muted-soft">
          No mandatory training is assigned to this Object yet.
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-brand-border bg-white p-6 text-sm text-brand-muted-soft">
          No students found in your group for this Object.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-brand-border bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-brand-hairline text-[11px] uppercase tracking-wide text-brand-muted-soft">
                <th className="px-5 py-3 font-semibold">Student</th>
                {data.courses.map((c) => (
                  <th key={c.moduleId} className="px-3 py-3 font-semibold">{c.title}</th>
                ))}
                <th className="px-5 py-3 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const key = `row-${s.memberId}`
                return (
                  <tr key={s.memberId} className="border-b border-brand-hairline last:border-0">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={s.name} id={s.memberId} size="sm" />
                        <span className="font-medium text-brand-blue-dark">{s.name}</span>
                      </div>
                    </td>
                    {data.courses.map((c) => (
                      <td key={c.moduleId} className="px-3 py-3">
                        <StatusPill status={s.statusByCourse[c.moduleId] ?? 'not_started'} />
                      </td>
                    ))}
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => nudge([s.memberId], key)}
                        disabled={isComplete(s.memberId) || busy === key}
                        className="rounded-lg border border-brand-border px-3 py-1.5 text-xs font-semibold text-brand-muted transition hover:bg-brand-canvas disabled:opacity-40"
                      >
                        {done.has(key) ? 'Sent' : busy === key ? '…' : 'Nudge'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
