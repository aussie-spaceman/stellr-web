'use client'

import { useMemo, useState } from 'react'
import { formatDateShort } from '@/lib/utils'
import Link from 'next/link'
import type { ComplianceState } from '@/lib/compliance'
import type { ComplianceAuditRow } from '@/lib/compliance-admin'
import { COMPLIANCE_PILL } from '@/components/admin/MemberCompliancePanel'
import { displayEventRole } from '@/lib/member-enums'

type Filter = 'attention' | 'all' | ComplianceState

const ATTENTION_STATES = new Set<ComplianceState>(['invalid', 'in_process', 'awaiting_verification', 'flagged'])

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'attention', label: 'Needs attention' },
  { key: 'flagged', label: 'Needs review' },
  { key: 'awaiting_verification', label: 'Waiting verification' },
  { key: 'invalid', label: 'Invalid' },
  { key: 'in_process', label: 'In Process' },
  { key: 'valid_bc', label: 'BC Passed' },
  { key: 'valid_license', label: 'License' },
  { key: 'all', label: 'All' },
]

// On a phone the table scrolls sideways inside its card instead of being
// clipped, with the member's name (the link to them) held at the left edge.
// border-separate: a sticky cell in a collapsed table leaves its borders
// behind when it moves, so row lines live on the cells.
const TH = 'whitespace-nowrap border-b border-line-light px-4 py-2.5 font-medium'
const TD = 'border-b border-line-light px-4 py-2.5 group-last:border-b-0'
const STICKY = 'sticky left-0 z-10 border-r border-line-light'

function fmt(iso: string) {
  return formatDateShort(iso)
}

export function ComplianceAuditTable({
  rows,
  counts,
}: {
  rows: ComplianceAuditRow[]
  counts: Record<ComplianceState, number>
}) {
  const [filter, setFilter] = useState<Filter>('attention')

  const filtered = useMemo(() => {
    if (filter === 'all') return rows
    if (filter === 'attention') return rows.filter((r) => ATTENTION_STATES.has(r.state))
    return rows.filter((r) => r.state === filter)
  }, [rows, filter])

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([
          { label: 'Invalid', value: counts.invalid, cls: 'text-red-700' },
          { label: 'In Process', value: counts.in_process, cls: 'text-orange-700' },
          { label: 'Cleared', value: counts.valid_bc + counts.valid_license, cls: 'text-emerald-700' },
          { label: 'Waiting verification', value: counts.awaiting_verification, cls: 'text-amber-700' },
        ] as const).map((c) => (
          <div key={c.label} className="rounded-xl border border-brand-border bg-white px-4 py-3">
            <p className={`text-2xl font-bold ${c.cls}`}>{c.value}</p>
            <p className="text-xs text-brand-muted-soft mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-xs font-medium rounded-full px-3 py-1.5 border ${
              filter === f.key
                ? 'bg-brand-blue text-white border-brand-blue'
                : 'bg-white text-brand-muted border-brand-border hover:bg-brand-canvas'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-brand-muted-soft bg-white rounded-xl border border-brand-border px-4 py-6">
          No members match this filter.
        </p>
      ) : (
        <div
          role="region"
          aria-label="Background checks and licenses"
          tabIndex={0}
          className="relative overflow-x-auto rounded-ds-card border border-line bg-white focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        >
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-content-muted">
                <th scope="col" className={`${TH} ${STICKY} bg-white`}>Member</th>
                <th scope="col" className={TH}>Role</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={TH}>Detail</th>
                <th scope="col" className={`${TH} text-right`}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const pill = COMPLIANCE_PILL[r.state]
                const reviewable = r.license && !r.license.verified_at
                return (
                  <tr key={r.memberId} className="group hover:bg-surface">
                    <td className={`${TD} ${STICKY} bg-white group-hover:bg-surface`}>
                      {/* Capped so a long email truncates instead of widening
                          the column that stays on screen. */}
                      <div className="max-w-48 sm:max-w-60">
                        <Link href={`/admin/members/${r.memberId}`} className="font-medium text-primary hover:underline">
                          {r.name}
                        </Link>
                        {r.email && <p className="text-xs text-content-muted truncate" title={r.email}>{r.email}</p>}
                      </div>
                    </td>
                    <td className={`${TD} whitespace-nowrap text-content-body`}>{displayEventRole(r.eventRole) ?? r.eventRole ?? '—'}</td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${pill.cls}`}>{pill.label}</span>
                      {reviewable && (
                        <span className="ml-1.5 inline-flex text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">
                          Review license
                        </span>
                      )}
                    </td>
                    <td className={`${TD} min-w-48 text-content-muted text-xs`}>{r.detail ?? '—'}</td>
                    <td className={`${TD} whitespace-nowrap text-right`}>
                      <Link
                        href={`/admin/members/${r.memberId}`}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        Manage →
                      </Link>
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
