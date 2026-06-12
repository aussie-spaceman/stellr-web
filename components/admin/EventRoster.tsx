'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { EventRosterData, ParticipantPill, RosterParticipant } from '@/lib/event-admin'
import type { CompanyRow } from '@/components/admin/EventCompanies'
import { DeleteEntityButton } from '@/components/admin/DeleteEntityButton'

const PILL_STYLES: Record<ParticipantPill, { label: string; className: string }> = {
  not_paid: { label: 'Not Paid', className: 'bg-red-100 text-red-700' },
  no_docusign: { label: 'No DocuSign', className: 'bg-red-100 text-red-700' },
  checked_in: { label: 'Checked In', className: 'bg-green-100 text-green-700' },
  registered: { label: 'Registered', className: 'bg-orange-100 text-orange-700' },
}

type PaymentFilter = 'all' | 'paid' | 'unpaid'
type DocusignFilter = 'all' | 'completed' | 'outstanding'

function matches(p: RosterParticipant, payment: PaymentFilter, docusign: DocusignFilter): boolean {
  if (payment === 'paid' && !p.paid) return false
  if (payment === 'unpaid' && p.paid) return false
  if (docusign === 'completed' && p.docusign !== 'completed') return false
  if (docusign === 'outstanding' && p.docusign !== 'outstanding') return false
  return true
}

export default function EventRoster({
  roster,
  exportHref,
  eventSlug,
  companies,
}: {
  roster: EventRosterData
  exportHref: string
  eventSlug: string
  companies: CompanyRow[]
}) {
  const router = useRouter()
  const [payment, setPayment] = useState<PaymentFilter>('all')
  const [docusign, setDocusign] = useState<DocusignFilter>('all')
  const [moving, setMoving] = useState<string | null>(null)

  async function moveParticipant(participantId: string, companyId: string | null) {
    setMoving(participantId)
    await fetch(`/api/admin/events/${eventSlug}/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'move', participantId, companyId }),
    })
    setMoving(null)
    router.refresh()
  }

  const companyLabel = (c: CompanyRow) => (c.name ? `${c.number} — ${c.name}` : `Company ${c.number}`)

  const filtered = useMemo(
    () =>
      roster.groups
        .map((g) => ({ ...g, participants: g.participants.filter((p) => matches(p, payment, docusign)) }))
        .filter((g) => g.participants.length > 0),
    [roster, payment, docusign]
  )
  const shown = filtered.reduce((n, g) => n + g.participants.length, 0)

  const select = 'border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white text-gray-700'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select value={payment} onChange={(e) => setPayment(e.target.value as PaymentFilter)} className={select}>
          <option value="all">Payment: All</option>
          <option value="paid">Payment: Paid</option>
          <option value="unpaid">Payment: Outstanding</option>
        </select>
        <select value={docusign} onChange={(e) => setDocusign(e.target.value as DocusignFilter)} className={select}>
          <option value="all">DocuSign: All</option>
          <option value="completed">DocuSign: Completed</option>
          <option value="outstanding">DocuSign: Outstanding</option>
        </select>
        <span className="text-sm text-gray-500">
          {shown} of {roster.summary.totalParticipants} participants
        </span>
        <a
          href={exportHref}
          className="ml-auto text-sm font-medium text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded-lg px-3 py-1.5"
        >
          Export CSV
        </a>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400 bg-white rounded-xl border border-gray-200 px-4 py-6">
          No participants match the current filters.
        </p>
      ) : (
        <div className="space-y-4">
          {filtered.map((group) => (
            <div
              key={group.registrationId}
              className={`rounded-xl border overflow-hidden ${
                group.type === 'group' ? 'border-indigo-200 bg-indigo-50/30' : 'border-gray-200 bg-white'
              }`}
            >
              <div
                className={`px-4 py-2 flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wide ${
                  group.type === 'group' ? 'bg-indigo-50 text-indigo-700' : 'bg-gray-50 text-gray-500'
                }`}
              >
                <span>{group.type === 'group' ? `Group — ${group.groupLabel}` : 'Individual Registration'}</span>
                <DeleteEntityButton
                  entity="registration"
                  id={group.registrationId}
                  name={group.type === 'group' ? `the group "${group.groupLabel}"` : 'this individual registration'}
                  label={group.type === 'group' ? 'Delete group' : 'Delete registration'}
                  refundable
                  className="text-xs font-medium text-red-600 hover:text-red-800 normal-case"
                />
              </div>
              <table className="w-full text-sm bg-white">
                <thead>
                  <tr className="border-b border-gray-100 text-left">
                    <th className="px-4 py-2 font-medium text-gray-500 text-xs uppercase tracking-wide">Name</th>
                    <th className="px-4 py-2 font-medium text-gray-500 text-xs uppercase tracking-wide">Role</th>
                    <th className="px-4 py-2 font-medium text-gray-500 text-xs uppercase tracking-wide">School</th>
                    <th className="px-4 py-2 font-medium text-gray-500 text-xs uppercase tracking-wide">Grade</th>
                    <th className="px-4 py-2 font-medium text-gray-500 text-xs uppercase tracking-wide">Shirt</th>
                    <th className="px-4 py-2 font-medium text-gray-500 text-xs uppercase tracking-wide">Company</th>
                    <th className="px-4 py-2 font-medium text-gray-500 text-xs uppercase tracking-wide">Status</th>
                    <th className="px-4 py-2 font-medium text-gray-500 text-xs uppercase tracking-wide text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {group.participants.map((p) => {
                    const pill = PILL_STYLES[p.pill]
                    return (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5">
                          <span className="font-medium text-gray-900">
                            {p.first_name} {p.last_name}
                          </span>
                          <p className="text-xs text-gray-400">{p.email}</p>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">{p.event_role ?? '—'}</td>
                        <td className="px-4 py-2.5 text-gray-600">{p.school_name ?? '—'}</td>
                        <td className="px-4 py-2.5 text-gray-600">{p.grade ?? '—'}</td>
                        <td className="px-4 py-2.5 text-gray-600">{p.t_shirt_size ?? '—'}</td>
                        <td className="px-4 py-2.5">
                          {p.event_role === 'school_student' ? (
                            companies.length === 0 ? (
                              <span className="text-gray-400">—</span>
                            ) : (
                              <select
                                value={p.company_id ?? ''}
                                disabled={moving === p.id}
                                onChange={(e) => moveParticipant(p.id, e.target.value || null)}
                                className="border border-gray-200 rounded px-2 py-1 text-xs bg-white text-gray-700 disabled:opacity-50"
                              >
                                <option value="">Unassigned</option>
                                {companies.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {companyLabel(c)}
                                  </option>
                                ))}
                              </select>
                            )
                          ) : (
                            <span className="text-gray-400">n/a</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${pill.className}`}>
                            {pill.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <DeleteEntityButton
                            entity="participant"
                            id={p.id}
                            name={`${p.first_name} ${p.last_name}'s registration`}
                            label="Delete"
                            softDeletable={false}
                            requireTypedConfirm={false}
                            refundable
                            className="text-xs font-medium text-red-600 hover:text-red-800"
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
