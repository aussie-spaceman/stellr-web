'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { EventRosterData, PaymentPill, RosterParticipant } from '@/lib/event-admin'
import { PILL_CLASSES as DOCUSIGN_PILL_CLASSES, type DocusignPill } from '@/lib/docusign-status'
import type { ComplianceState } from '@/lib/compliance'
import type { CompanyRow } from '@/components/admin/EventCompanies'
import { DeleteEntityButton } from '@/components/admin/DeleteEntityButton'
import { SendPayLinkButton } from '@/components/admin/SendPayLinkButton'
import { ReissueDocusignButton } from '@/components/admin/ReissueDocusignButton'
import { CorrectSignerEmailButton } from '@/components/admin/CorrectSignerEmailButton'
import { displayEventRole } from '@/lib/member-enums'
import { STUDENT_ROLES } from '@/lib/membership-rules'

// Pills with paperwork still to chase. 'issued'/'partial' resend the live
// envelope; the rest need a new one (the server confirms before spending quota).
const REISSUABLE_PILLS = new Set<DocusignPill>(['not_issued', 'issued', 'partial', 'bounced', 'declined', 'voided'])

const PAYMENT_PILLS: Record<PaymentPill, { label: string; className: string }> = {
  invoice_issued: { label: 'Invoice Issued', className: 'bg-red-100 text-red-700' },
  invoice_paid:   { label: 'Invoice Paid',   className: 'bg-green-100 text-green-700' },
  link_unpaid:    { label: 'Pmt Link Unpaid', className: 'bg-red-100 text-red-700' },
  link_paid:      { label: 'Pmt Link Paid',   className: 'bg-green-100 text-green-700' },
  // Free event — settled, but nothing was ever charged. Deliberately not green:
  // staff reconciling payments need to tell this apart from money received.
  waived:         { label: 'No Fee',           className: 'bg-brand-hairline text-brand-muted-soft' },
}

// Label and colour both come from lib/docusign-status now. This file used to
// keep its own copy, which is how the roster, the admin table and the portal
// ended up describing the same envelope three different ways.

// Background-check / license pill (PRD §13). Two shades of green — emerald for a
// passed background check, green for a verified license — plus orange in-process
// and red "Invalid" (required but nothing valid on file, or expired).
const COMPLIANCE_PILLS: Record<ComplianceState, { label: string; className: string }> = {
  not_required:  { label: 'n/a',        className: 'bg-brand-hairline text-brand-muted-soft' },
  valid_bc:      { label: 'BC Passed',  className: 'bg-emerald-100 text-emerald-700' },
  flagged:       { label: 'Needs review', className: 'bg-red-100 text-red-700 ring-1 ring-red-300' },
  valid_license: { label: 'License',    className: 'bg-green-100 text-green-700' },
  in_process:    { label: 'In Process', className: 'bg-orange-100 text-orange-700' },
  cancelled:     { label: 'Cancelled',  className: 'bg-amber-100 text-amber-700' },
  expired:       { label: 'Expired',    className: 'bg-amber-100 text-amber-700' },
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
const OUTSTANDING_STATES: ComplianceState[] = ['invalid', 'in_process', 'flagged']

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
  isAdmin,
}: {
  roster: EventRosterData
  exportHref: string
  eventSlug: string
  companies: CompanyRow[]
  /** Admins export Checkr's reports; event managers get the clearance summary. */
  isAdmin: boolean
}) {
  const router = useRouter()
  const [payment, setPayment] = useState<PaymentFilter>('all')
  const [docusign, setDocusign] = useState<DocusignFilter>('all')
  const [compliance, setCompliance] = useState<ComplianceFilter>('all')
  const [scholarshipOnly, setScholarshipOnly] = useState(false)
  const [moving, setMoving] = useState<string | null>(null)
  const [markingInvoice, setMarkingInvoice] = useState<string | null>(null)

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

  async function markInvoicePaid(registrationId: string, paid: boolean) {
    setMarkingInvoice(registrationId)
    await fetch(`/api/admin/events/${eventSlug}/invoice-paid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationId, paid }),
    })
    setMarkingInvoice(null)
    router.refresh()
  }

  const companyLabel = (c: CompanyRow) => (c.name ? `${c.number} — ${c.name}` : `Company ${c.number}`)

  const filtered = useMemo(
    () =>
      roster.groups
        .filter((g) => !scholarshipOnly || g.scholarship)
        .map((g) => ({ ...g, participants: g.participants.filter((p) => matches(p, payment, docusign, compliance)) }))
        .filter((g) => g.participants.length > 0),
    [roster, payment, docusign, compliance, scholarshipOnly]
  )
  const shown = filtered.reduce((n, g) => n + g.participants.length, 0)

  const select = 'border border-brand-border rounded-lg px-3 py-1.5 text-sm bg-white text-brand-muted'

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
        <select
          value={scholarshipOnly ? 'holders' : 'all'}
          onChange={(e) => setScholarshipOnly(e.target.value === 'holders')}
          className={select}
        >
          <option value="all">Scholarship: All</option>
          <option value="holders">Scholarship: Holders only</option>
        </select>
        <span className="text-sm text-brand-muted-soft">
          {shown} of {roster.summary.totalParticipants} participants
          {roster.summary.scholarshipHolders > 0 && ` · ${roster.summary.scholarshipHolders} on scholarship`}
        </span>
        {/* Bulk reminders moved to the Email Reminders tab (editable copy,
            attachments, scheduling, history). The old one-click route,
            /api/admin/events/[slug]/remind, is left in place for now. */}
        <Link
          href={`/admin/competitions/${eventSlug}?tab=emails`}
          className="ml-auto text-sm font-medium text-white bg-brand-blue hover:bg-brand-blue-dark rounded-lg px-3 py-1.5"
        >
          Email Reminders
        </Link>
        <a
          href={exportHref}
          className="text-sm font-medium text-brand-blue hover:text-brand-blue border border-brand-blue rounded-lg px-3 py-1.5"
        >
          Export CSV
        </a>
        {/* Admins get both: Checkr's reports (admins only, FCRA) and the
            clearance summary an event team can be given. Event managers get
            the summary alone. */}
        {isAdmin && (
          <a
            href={`/api/admin/events/${eventSlug}/background-reports`}
            title="Cover page plus each cleared mentor's Checkr report, fetched from Checkr now. Admins only."
            className="text-sm font-medium text-brand-blue hover:text-brand-blue border border-brand-blue rounded-lg px-3 py-1.5"
          >
            Mentor Reports (PDF)
          </a>
        )}
        <a
          href={`/api/admin/events/${eventSlug}/background-reports?mode=summary`}
          title="Each mentor's clearance status and dates, with no Checkr report pages."
          className="text-sm font-medium text-brand-blue hover:text-brand-blue border border-brand-blue rounded-lg px-3 py-1.5"
        >
          Mentor Clearance (PDF)
        </a>
      </div>

      {/* Offered, but the student hasn't completed their details — so there is
          no registration row yet. Shown here so the roster is the whole picture. */}
      {roster.scholarshipOffers.length > 0 && (
        <div className="rounded-xl border border-line bg-white overflow-hidden">
          <div className="px-4 py-2 bg-primary-soft text-xs font-subheading font-semibold uppercase tracking-wide text-primary-deep">
            Scholarship offers — awaiting registration details ({roster.scholarshipOffers.length})
          </div>
          <ul className="divide-y divide-brand-hairline text-sm">
            {roster.scholarshipOffers.map((o) => (
              <li key={o.id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-medium text-brand-blue-dark">{o.name}</span>
                <span className="text-xs text-brand-muted-soft">{o.email}</span>
                <ScholarshipBadge percent={o.percentOff} />
                {o.offeredAt && (
                  <span className="text-xs text-brand-muted-soft">
                    offered {new Date(o.offeredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                )}
                {isAdmin && (
                  <Link href={`/admin/scholarships/${o.id}`} className="ml-auto text-xs font-medium text-brand-blue hover:text-brand-blue-dark">
                    View application
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-brand-muted-soft bg-white rounded-xl border border-brand-border px-4 py-6">
          No participants match the current filters.
        </p>
      ) : (
        <div className="space-y-4">
          {filtered.map((group) => (
            <div
              key={group.registrationId}
              className={`rounded-xl border overflow-hidden ${
                group.type === 'group' ? 'border-brand-blue bg-brand-blue/5/30' : 'border-brand-border bg-white'
              }`}
            >
              <div
                className={`px-4 py-2 flex items-center justify-between gap-3 text-xs font-subheading font-semibold uppercase tracking-wide ${
                  group.type === 'group' ? 'bg-brand-blue/5 text-brand-blue' : 'bg-brand-canvas text-brand-muted-soft'
                }`}
              >
                <span className="flex items-center gap-2">
                  {group.type === 'group' ? `Group — ${group.groupLabel}` : 'Individual Registration'}
                  {group.scholarship && (
                    <ScholarshipBadge percent={group.scholarship.percentOff} refundCents={group.scholarship.refundCents} />
                  )}
                </span>
                {/* Individual registrations need no header delete — the per-row
                    "Delete Registration" removes the participant and auto-withdraws
                    the emptied registration. */}
                <span className="flex items-center gap-3">
                  {/* Invoiced groups are settled offline — an admin records payment
                      here so member/roster pills read truthfully and a receipt opens. */}
                  {group.type === 'group' && group.invoiceRequested && (
                    <span className="flex items-center gap-2 normal-case">
                      {group.invoicePaidAt ? (
                        <button
                          type="button"
                          onClick={() => markInvoicePaid(group.registrationId, false)}
                          disabled={markingInvoice === group.registrationId}
                          className="text-xs font-medium text-brand-muted-soft hover:text-red-700 disabled:opacity-50"
                        >
                          Invoice paid ✓ · mark unpaid
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => markInvoicePaid(group.registrationId, true)}
                          disabled={markingInvoice === group.registrationId}
                          className="text-xs font-medium text-green-700 hover:text-green-800 disabled:opacity-50"
                        >
                          {markingInvoice === group.registrationId ? 'Saving…' : 'Mark invoice paid'}
                        </button>
                      )}
                    </span>
                  )}
                  {group.type === 'group' && group.payLinkSendable && (
                    <SendPayLinkButton eventSlug={eventSlug} registrationId={group.registrationId} className="normal-case" />
                  )}
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
                </span>
              </div>
              <table className="w-full table-fixed text-sm bg-white">
                <colgroup>
                  {COLUMNS.map((c) => (
                    <col key={c.label} style={{ width: c.width }} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="border-b border-brand-hairline text-left">
                    {COLUMNS.map((c) => (
                      <th
                        key={c.label}
                        className={`px-4 py-2 font-medium text-brand-muted-soft text-xs uppercase tracking-wide ${
                          c.label === 'Actions' ? 'text-right' : ''
                        }`}
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-hairline">
                  {group.participants.map((p) => (
                    <tr key={p.id} className="hover:bg-brand-canvas">
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-brand-blue-dark">
                          {p.first_name} {p.last_name}
                        </span>
                        <p className="text-xs text-brand-muted-soft truncate" title={p.email}>
                          {p.email}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-brand-muted">{displayEventRole(p.event_role) ?? p.event_role ?? '—'}</td>
                      <td className="px-4 py-2.5 text-brand-muted">{p.school_name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-brand-muted">{p.grade ?? '—'}</td>
                      <td className="px-4 py-2.5 text-brand-muted">{p.t_shirt_size ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        {STUDENT_ROLES.includes(p.event_role ?? '') ? (
                          companies.length === 0 ? (
                            <span className="text-brand-muted-soft">—</span>
                          ) : (
                            <select
                              value={p.company_id ?? ''}
                              disabled={moving === p.id}
                              onChange={(e) => moveParticipant(p.id, e.target.value || null)}
                              className="border border-brand-border rounded px-2 py-1 text-xs bg-white text-brand-muted disabled:opacity-50 max-w-full"
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
                          <span className="text-brand-muted-soft">n/a</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <Pill {...PAYMENT_PILLS[p.payment_pill]} />
                        {/* Refunded in the Stripe dashboard. The pill stays "paid"
                            because the money did arrive; this says it went back. */}
                        {p.refund_detail && (
                          <p className="mt-1 text-[11px] leading-tight text-brand-grey-dark">{p.refund_detail}</p>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <Pill label={p.docusign_label} className={DOCUSIGN_PILL_CLASSES[p.docusign_pill]} />
                        {/* Names the outstanding signer. Without this, answering
                            "we already signed it" meant querying the DB and then
                            DocuSign — which is exactly what happened on 4 Sept 2026. */}
                        {p.docusign_detail && (
                          <p className="mt-1 text-[11px] leading-tight text-brand-grey-dark">{p.docusign_detail}</p>
                        )}
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
                      <td className="px-4 py-2.5 text-right space-x-3">
                        {group.type === 'individual' && group.payLinkSendable && (
                          <SendPayLinkButton eventSlug={eventSlug} registrationId={group.registrationId} />
                        )}
                        {p.event_role === 'mentor' && p.compliance_pill === 'valid_bc' && (
                          <a
                            href={`/api/admin/events/${eventSlug}/background-reports?participant=${p.id}`}
                            className="text-xs font-medium text-brand-blue hover:text-brand-blue-dark"
                          >
                            {isAdmin ? 'Checkr Report' : 'Clearance PDF'}
                          </a>
                        )}
                        {/* Fixes a typo or bounce on the same envelope: keeps
                            signatures and uses no monthly envelope, so it comes
                            before Reissue (which voids and starts again). */}
                        {p.correctable_agreement_id && (
                          <CorrectSignerEmailButton
                            agreementId={p.correctable_agreement_id}
                            emphasise={p.docusign_pill === 'bounced'}
                          />
                        )}
                        {REISSUABLE_PILLS.has(p.docusign_pill) && (
                          <ReissueDocusignButton eventSlug={eventSlug} participantId={p.id} />
                        )}
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

// "Scholarship · 50%" — marks a registration held under a scholarship.
function ScholarshipBadge({ percent, refundCents }: { percent: number; refundCents?: number | null }) {
  return (
    <span className="inline-flex items-center rounded-full bg-pathway-amber-bg px-2 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-ink">
      Scholarship · {percent}%
      {refundCents ? ` · $${(refundCents / 100).toFixed(2)} reimbursed` : ''}
    </span>
  )
}
