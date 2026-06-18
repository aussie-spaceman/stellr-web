'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { ComplianceState } from '@/lib/compliance'
import type { ComplianceAuditRow } from '@/lib/compliance-admin'
import { COMPLIANCE_PILL } from '@/components/admin/MemberCompliancePanel'
import { displayEventRole } from '@/lib/member-enums'

type Filter = 'attention' | 'all' | ComplianceState

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'attention', label: 'Needs attention' },
  { key: 'invalid', label: 'Invalid' },
  { key: 'in_process', label: 'In Process' },
  { key: 'valid_bc', label: 'BC Passed' },
  { key: 'valid_license', label: 'License' },
  { key: 'all', label: 'All' },
]

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function ComplianceAuditTable({
  rows,
  counts,
  reviewQueueCount,
}: {
  rows: ComplianceAuditRow[]
  counts: Record<ComplianceState, number>
  reviewQueueCount: number
}) {
  const [filter, setFilter] = useState<Filter>('attention')

  const filtered = useMemo(() => {
    if (filter === 'all') return rows
    if (filter === 'attention') return rows.filter((r) => r.state === 'invalid' || r.state === 'in_process')
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
          { label: 'Awaiting license review', value: reviewQueueCount, cls: 'text-amber-700' },
        ] as const).map((c) => (
          <div key={c.label} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            <p className={`text-2xl font-bold ${c.cls}`}>{c.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{c.label}</p>
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
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400 bg-white rounded-xl border border-gray-200 px-4 py-6">
          No members match this filter.
        </p>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2.5 font-medium">Member</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Detail</th>
                <th className="px-4 py-2.5 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((r) => {
                const pill = COMPLIANCE_PILL[r.state]
                const reviewable = r.license && !r.license.verified_at
                return (
                  <tr key={r.memberId} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/members/${r.memberId}`} className="font-medium text-indigo-600 hover:text-indigo-800">
                        {r.name}
                      </Link>
                      {r.email && <p className="text-xs text-gray-400 truncate">{r.email}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{displayEventRole(r.eventRole) ?? r.eventRole ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${pill.cls}`}>{pill.label}</span>
                      {reviewable && (
                        <span className="ml-1.5 inline-flex text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">
                          Review license
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{r.detail ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        href={`/admin/members/${r.memberId}`}
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
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
