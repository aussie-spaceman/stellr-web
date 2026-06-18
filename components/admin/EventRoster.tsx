'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { EventRosterData, PaymentPill, DocusignPill, RosterParticipant } from '@/lib/event-admin'
import type { ComplianceState } from '@/lib/compliance'
import type { CompanyRow } from '@/components/admin/EventCompanies'
import { DeleteEntityButton } from '@/components/admin/DeleteEntityButton'
import { displayEventRole } from '@/lib/member-enums'

const PAYMENT_PILLS: Record<PaymentPill, { label: string; className: string }> = {
  invoice_issued: { label: 'Invoice Issued', className: 'bg-red-100 text-red-700' },
  invoice_paid:   { label: 'Invoice Paid',   className: 'bg-green-100 text-green-700' },
  link_unpaid:    { label: 'Pmt Link Unpaid', className: 'bg-red-100 text-red-700' },
  link_paid:      { label: 'Pmt Link Paid',   className: 'bg-green-100 text-green-700' },
}

const DOCUSIGN_PILLS: Record<DocusignPill, { label: string; className: string }> = {
  not_required: { label: 'Not Required', className: 'bg-gray-100 text-gray-500' },
  not_issued:   { label: 'Not Issued', className: 'bg-red-100 text-red-700' },
  issued:       { label: 'Issued', className: 'bg-red-100 text-red-700' },
  partial:      { label: 'Partially Complete', className: 'bg-orange-100 text-orange-700' },
  declined:     { label: 'Declined', className: 'bg-red-100 text-red-700' },
  complete:     { label: 'Complete', className: 'bg-green-100 text-green-700' },
}

// Background-check / license pill (PRD §13). Two shades of green — emerald for a
// passed background check, green for a verified license — plus orange in-process
// and red "Invalid" (required but nothing valid on file, or expired).
const COMPLIANCE_PILLS: Record<ComplianceState, { label: string; className: string }> = {
  not_required:  { label: 'n/a',        className: 'bg-gray-100 text-gray-400' },
  valid_bc:      { label: 'BC Passed',  className: 'bg-emerald-100 text-emerald-700' },
  valid_license: { label: 'License',    className: 'bg-green-100 text-green-700' },
  in_process:    { label: 'In Process', className: 'bg-orange-100 text-orange-700' },
  invalid:       { label: 'Invalid',    className: 'bg-red-100 text-red-700' },
}

// Shared column widths so every group/individual table aligns line-to-line.
// table-fixed + a common colgroup keeps the columns identical across sections.
const COLUMNS = [
  { label: 'Name', width: '15%' },
  { label: 'Role', width: '7%' },
  { label: 'School', width: '11%' },
  { label: 'Grade', width: '5%' },
  { label: 'Shirt', width: '5%' },
  { label: 'Company', width: '9%' },
  { label: 'Payment', width: '10%' },
  { label: 'DocuSign', width: '10%' },
  { label: 'Background', width: '10%' },
  { label: 'Status', width: '8%' },
  { label: 'Actions', width: '10%' },
] as const

type PaymentFilter = 'all' | 'paid' | 'unpaid'
type DocusignFilter = 'all' | 'completed' | 'outstanding'
type ComplianceFilter = 'all' | 'cleared' | 'outstanding'

const CLEARED_STATES: ComplianceState[] = ['valid_bc', 'valid_license']
const OUTSTANDING_STATES: ComplianceState[] = ['invalid', 'in_process']

function matches(
  p: RosterParticipant,
  payment: PaymentFilter,
  docusign: DocusignFilter,
  compliance: ComplianceFilter,
): boolean {
  if (payment === 'paid' && !p.paid) return false
  if (payment === 'unpaid' && p.paid) return false
  if (docusign === 'completed' && p.docusign !== 'completed') return false
  if (docusign === 'outstanding' && p.docusign !== 'outstanding') return false
  if (compliance === 'cleared' && !CLEARED_STATES.includes(p.compliance_pill)) return false
  if (compliance === 'outstanding' && !OUTSTANDING_STATES.includes(p.compliance_pill)) return false
  return true
}

function Pill({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${className}`}>
      {label}
    </span>
  )
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
  const [compliance, setCompliance] = useState<ComplianceFilter>('all')
  const [moving, setMoving] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<string | null>(null)

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
        .map((g) => ({ ...g, participants: g.participants.filter((p) => matches(p, payment, docusign, compliance)) }))
        .filter((g) => g.participants.length > 0),
    [roster, payment, docusign, compliance]
  )
  const shown = filtered.reduce((n, g) => n + g.participants.length, 0)

  // One-click reminders for the currently filtered outstanding participants.
  const remindPayment = payment === 'unpaid'
  const remindDocusign = docusign === 'outstanding'
  const canRemind = (remindPayment || remindDocusign) && shown > 0
  const remindLabel =
    remindPayment && remindDocusign
      ? 'Email Reminders'
      : remindPayment
        ? 'Email Payment Reminders'
        : 'Email DocuSign Reminders'

  async function sendReminders() {
    const what =
      remindPayment && remindDocusign
        ? 'payment and DocuSign reminders'
        : remindPayment
          ? 'payment reminders'
          : 'DocuSign reminders'
    const ok = confirm(
      `Send ${what} to the ${shown} participant${shown === 1 ? '' : 's'} currently shown?\n\n` +
        'Minors are CC’d to their emergency contact; group members are CC’d to their teacher / student manager.'
    )
    if (!ok) return

    setSending(true)
    setSendResult(null)
    try {
      const res = await fetch(`/api/admin/events/${eventSlug}/remind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment: remindPayment, docusign: remindDocusign }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setSendResult(data?.error ?? 'Failed to send reminders.')
      } else {
        setSendResult(
          `Sent ${data.sent} reminder email${data.sent === 1 ? '' : 's'}` +
            (data.failed > 0 ? ` (${data.failed} failed)` : '')
        )
      }
    } catch {
      setSendResult('Failed to send reminders.')
    }
    setSending(false)
  }

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
        <select value={compliance} onChange={(e) => setCompliance(e.target.value as ComplianceFilter)} className={select}>
          <option value="all">Background: All</option>
          <option value="cleared">Background: Cleared</option>
          <option value="outstanding">Background: Outstanding</option>
        </select>
        <span className="text-sm text-gray-500">
          {shown} of {roster.summary.totalParticipants} participants
        </span>
        {sendResult && <span className="text-sm text-gray-600">{sendResult}</span>}
        <button
          type="button"
          onClick={sendReminders}
          disabled={!canRemind || sending}
          title={
            canRemind
              ? undefined
              : 'Filter by Payment: Outstanding or DocuSign: Outstanding to email those participants'
          }
          className="ml-auto text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg px-3 py-1.5"
        >
          {sending ? 'Sending…' : remindPayment || remindDocusign ? remindLabel : 'Email Reminders'}
        </button>
        <a
          href={exportHref}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded-lg px-3 py-1.5"
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
                {/* Individual registrations need no header delete — the per-row
                    "Delete Registration" removes the participant and auto-withdraws
                    the emptied registration. */}
                {group.type === 'group' && (
                  <DeleteEntityButton
                    entity="registration"
                    id={group.registrationId}
                    name={`the group "${group.groupLabel}"`}
                    label="Delete group"
                    refundable
                    className="text-xs font-medium text-red-600 hover:text-red-800 normal-case"
                  />
                )}
              </div>
              <table className="w-full table-fixed text-sm bg-white">
                <colgroup>
                  {COLUMNS.map((c) => (
                    <col key={c.label} style={{ width: c.width }} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="border-b border-gray-100 text-left">
                    {COLUMNS.map((c) => (
                      <th
                        key={c.label}
                        className={`px-4 py-2 font-medium text-gray-500 text-xs uppercase tracking-wide ${
                          c.label === 'Actions' ? 'text-right' : ''
                        }`}
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {group.participants.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-gray-900">
                          {p.first_name} {p.last_name}
                        </span>
                        <p className="text-xs text-gray-400 truncate" title={p.email}>
                          {p.email}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">{displayEventRole(p.event_role) ?? p.event_role ?? '—'}</td>
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
                              className="border border-gray-200 rounded px-2 py-1 text-xs bg-white text-gray-700 disabled:opacity-50 max-w-full"
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
                        <Pill {...PAYMENT_PILLS[p.payment_pill]} />
                      </td>
                      <td className="px-4 py-2.5">
                        <Pill {...DOCUSIGN_PILLS[p.docusign_pill]} />
                      </td>
                      <td className="px-4 py-2.5">
                        <Pill {...COMPLIANCE_PILLS[p.compliance_pill]} />
                      </td>
                      <td className="px-4 py-2.5">
                        {p.checked_in_at ? (
                          <Pill label="Checked In" className="bg-green-100 text-green-700" />
                        ) : (
                          <Pill label="Registered" className="bg-orange-100 text-orange-700" />
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <DeleteEntityButton
                          entity="participant"
                          id={p.id}
                          name={`${p.first_name} ${p.last_name}'s registration`}
                          label="Delete Registration"
                          softDeletable={false}
                          requireTypedConfirm={false}
                          refundable
                          className="text-xs font-medium text-red-600 hover:text-red-800"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
