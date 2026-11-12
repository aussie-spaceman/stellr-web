'use client'

import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { EventRosterData, PaymentPill, RosterGroup, RosterParticipant } from '@/lib/event-admin'
import { PILL_CLASSES as DOCUSIGN_PILL_CLASSES, type DocusignPill } from '@/lib/docusign-status'
import type { ComplianceState } from '@/lib/compliance'
import { displayGrade } from '@/lib/member-enums'
import type { CompanyRow } from '@/components/admin/EventCompanies'
import { DeleteEntityButton } from '@/components/admin/DeleteEntityButton'
import { SendPayLinkButton } from '@/components/admin/SendPayLinkButton'
import { ReissueDocusignButton } from '@/components/admin/ReissueDocusignButton'
import { CorrectSignerEmailButton } from '@/components/admin/CorrectSignerEmailButton'
import { FixGuardianEmailButton } from '@/components/admin/FixGuardianEmailButton'
import { FinishSetupButton } from '@/components/admin/FinishSetupButton'
import { GroupInvoiceButton } from '@/components/admin/GroupInvoiceButton'
import { GroupPaymentMethod } from '@/components/registration/GroupPaymentMethod'
import { AdminAddParticipantButton } from '@/components/admin/AdminAddParticipantButton'
import { displayEventRole } from '@/lib/member-enums'
import { STUDENT_ROLES } from '@/lib/membership-rules'
import { Collapsible, CollapsibleGroup, CollapseAllControls } from '@stellr/web-ui'
import { MemberLink, SchoolLink } from '@/components/admin/RecordLinks'

// Pills with paperwork still to chase. 'issued'/'partial' resend the live
// envelope; the rest need a new one (the server confirms before spending quota).
const REISSUABLE_PILLS = new Set<DocusignPill>(['not_issued', 'issued', 'partial', 'bounced', 'declined', 'voided', 'failed'])
// Nothing is out for signing, so a wrong guardian address is fixed on the record.
const GUARDIAN_FIXABLE_PILLS = new Set<DocusignPill>(['not_issued', 'failed'])

const PAYMENT_PILLS: Record<PaymentPill, { label: string; className: string }> = {
  invoice_issued: { label: 'Invoice Issued', className: 'bg-red-100 text-red-700' },
  invoice_paid:   { label: 'Invoice Paid',   className: 'bg-green-100 text-green-700' },
  link_unpaid:    { label: 'Pmt Link Unpaid', className: 'bg-red-100 text-red-700' },
  link_paid:      { label: 'Pmt Link Paid',   className: 'bg-green-100 text-green-700' },
  // Free event — settled, but nothing was ever charged. Deliberately not green:
  // staff reconciling payments need to tell this apart from money received.
  waived:         { label: 'No Fee',           className: 'bg-brand-hairline text-brand-muted-soft' },
  // A teacher whose place the students' shares pay for (lib/teacher-share.ts).
  covered:        { label: 'Shared by Students', className: 'bg-brand-hairline text-brand-muted-soft' },
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
  awaiting_verification: { label: 'Waiting verification', className: 'bg-orange-100 text-orange-700 ring-1 ring-orange-300' },
  cancelled:     { label: 'Cancelled',  className: 'bg-amber-100 text-amber-700' },
  expired:       { label: 'Expired',    className: 'bg-amber-100 text-amber-700' },
  invalid:       { label: 'Invalid',    className: 'bg-red-100 text-red-700' },
}

// Shared column widths so every group/individual table aligns line-to-line.
// table-fixed + a common colgroup keeps the columns identical across sections.
// The table only shows from lg up (phones and portrait tablets get one card
// per participant), and it never shrinks below the content column: squeezed
// into a 732px pane beside the sidebar, eleven percentage columns left Grade
// a few pixels wide. Narrower than that, the table scrolls sideways with the
// name column held at the left edge.
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

// border-separate: a sticky cell in a collapsed table leaves its borders
// behind when it moves, so the row lines live on the cells, not the rows.
const TD = 'border-b border-line-light px-4 py-2.5 group-last:border-b-0'
const STICKY = 'sticky left-0 z-10 border-r border-line-light'

// Row actions on a participant card: 44px tall, so they can be hit with a
// thumb. TAP_WRAPPED styles the button inside SendPayLinkButton and
// ReissueDocusignButton, whose className lands on a wrapping <span>.
const TAP = 'inline-flex min-h-11 items-center justify-center rounded-control border border-line bg-white px-3 text-sm font-medium'
const TAP_WRAPPED =
  'flex-wrap [&>button]:inline-flex [&>button]:min-h-11 [&>button]:items-center [&>button]:rounded-control [&>button]:border [&>button]:border-line [&>button]:bg-white [&>button]:px-3 [&>button]:text-sm'

type PaymentFilter = 'all' | 'paid' | 'unpaid'
type DocusignFilter = 'all' | 'completed' | 'outstanding'
type ComplianceFilter = 'all' | 'cleared' | 'outstanding'

const CLEARED_STATES: ComplianceState[] = ['valid_bc', 'valid_license']
const OUTSTANDING_STATES: ComplianceState[] = ['invalid', 'in_process', 'awaiting_verification', 'flagged']

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

  // Each participant renders twice — a card below lg, a table row from lg up —
  // so the cells and actions are built once here and used by both.

  // Students (auto-assign places them) and mentors (placed here by hand) get a
  // company number to be told at check-in.
  const placeable = (p: RosterParticipant) => STUDENT_ROLES.includes(p.event_role ?? '') || p.event_role === 'mentor'

  const companySelect = (p: RosterParticipant, className: string) => (
    <select
      value={p.company_id ?? ''}
      disabled={moving === p.id}
      onChange={(e) => moveParticipant(p.id, e.target.value || null)}
      aria-label={`Company for ${p.first_name} ${p.last_name}`}
      className={className}
    >
      <option value="">Unassigned</option>
      {companies.map((c) => (
        <option key={c.id} value={c.id}>
          {companyLabel(c)}
        </option>
      ))}
    </select>
  )

  const paymentCell = (p: RosterParticipant) => (
    <>
      <Pill {...PAYMENT_PILLS[p.payment_pill]} />
      {/* Refunded in the Stripe dashboard. The pill stays "paid"
          because the money did arrive; this says it went back. */}
      {p.refund_detail && <p className="mt-1 text-xs leading-tight text-brand-grey-dark">{p.refund_detail}</p>}
    </>
  )

  const docusignCell = (p: RosterParticipant) => (
    <>
      <Pill label={p.docusign_label} className={DOCUSIGN_PILL_CLASSES[p.docusign_pill]} />
      {/* Names the outstanding signer. Without this, answering
          "we already signed it" meant querying the DB and then
          DocuSign — which is exactly what happened on 4 Sept 2026. */}
      {p.docusign_detail && <p className="mt-1 text-xs leading-tight text-brand-grey-dark">{p.docusign_detail}</p>}
    </>
  )

  const statusPill = (p: RosterParticipant) =>
    p.checked_in_at ? (
      <Pill label="Checked In" className="bg-green-100 text-green-700" />
    ) : (
      <Pill label="Registered" className="bg-orange-100 text-orange-700" />
    )

  const rowActions = (group: RosterGroup, p: RosterParticipant, card: boolean) => (
    <>
      {group.type === 'individual' && group.payLinkSendable && (
        <SendPayLinkButton
          eventSlug={eventSlug}
          registrationId={group.registrationId}
          className={card ? TAP_WRAPPED : undefined}
        />
      )}
      {p.event_role === 'mentor' && p.compliance_pill === 'valid_bc' && (
        <a
          href={`/api/admin/events/${eventSlug}/background-reports?participant=${p.id}`}
          className={card ? `${TAP} text-primary` : 'text-xs font-medium text-brand-blue hover:text-brand-blue-dark'}
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
          className={card ? TAP : undefined}
        />
      )}
      {p.minor && GUARDIAN_FIXABLE_PILLS.has(p.docusign_pill) && (
        <FixGuardianEmailButton
          eventSlug={eventSlug}
          participantId={p.id}
          studentName={`${p.first_name} ${p.last_name}`}
          currentEmail={p.emergency_contact_email}
          className={card ? TAP : undefined}
        />
      )}
      {REISSUABLE_PILLS.has(p.docusign_pill) && (
        <ReissueDocusignButton
          eventSlug={eventSlug}
          participantId={p.id}
          className={card ? TAP_WRAPPED : undefined}
        />
      )}
      <DeleteEntityButton
        entity="participant"
        id={p.id}
        name={`${p.first_name} ${p.last_name}'s registration`}
        label="Delete Registration"
        softDeletable={false}
        requireTypedConfirm={false}
        refundable
        className={card ? `${TAP} text-danger` : 'text-xs font-medium text-red-600 hover:text-red-800'}
      />
    </>
  )

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
    <Collapsible
      id="registrations"
      title="Registrations"
      summary={`${roster.summary.groupRegistrations} group${roster.summary.groupRegistrations === 1 ? '' : 's'} · ${roster.summary.individualRegistrations} individual · ${roster.summary.totalParticipants} participants`}
      bodyClassName="space-y-4 p-4"
    >
    {/* Each registration folds to a summary line; the folds are remembered per
        browser and event, and Expand all / Collapse all act on the groups only. */}
    <CollapsibleGroup storageKey={`event.${eventSlug}.groups`}>
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
        <CollapseAllControls label="Expand or collapse registrations" />
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
        <Collapsible
          id="scholarship-offers"
          tone="primary"
          headingLevel={3}
          title="Scholarship offers awaiting registration details"
          summary={`${roster.scholarshipOffers.length} offered`}
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-brand-hairline text-sm">
            {roster.scholarshipOffers.map((o) => (
              <li key={o.id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                <MemberLink memberId={o.memberId} className="font-medium text-brand-blue-dark">
                  {o.name}
                </MemberLink>
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
        </Collapsible>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-brand-muted-soft bg-white rounded-xl border border-brand-border px-4 py-6">
          No participants match the current filters.
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((group) => (
            <Collapsible
              key={group.registrationId}
              id={group.registrationId}
              tone={group.type === 'group' ? 'primary' : 'muted'}
              headingLevel={3}
              defaultOpen={false}
              bodyClassName="p-0"
              title={
                <span className="inline-flex flex-wrap items-center gap-2">
                  {group.type === 'group'
                    ? `Group: ${group.groupLabel}`
                    : `Individual: ${group.participants.map((p) => `${p.first_name} ${p.last_name}`).join(', ')}`}
                  {group.scholarship && (
                    <ScholarshipBadge percent={group.scholarship.percentOff} refundCents={group.scholarship.refundCents} />
                  )}
                </span>
              }
              summary={groupSummary(group.participants)}
              actions={
                group.type === 'group' ? (
                  <>
                    {/* Invoiced groups are settled offline — an admin records payment
                        here so member/roster pills read truthfully and a receipt opens. */}
                    {group.invoiceRequested &&
                      (group.invoicePaidAt ? (
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
                      ))}
                    {group.payLinkSendable && <SendPayLinkButton eventSlug={eventSlug} registrationId={group.registrationId} />}
                    <AdminAddParticipantButton registrationId={group.registrationId} />
                    <FinishSetupButton registrationId={group.registrationId} groupLabel={group.groupLabel ?? 'This group'} />
                    {group.invoiceRequested && (
                      <GroupInvoiceButton registrationId={group.registrationId} groupLabel={group.groupLabel ?? 'This group'} />
                    )}
                    <GroupPaymentMethod
                      endpoint={`/api/admin/registrations/${group.registrationId}/payment-method`}
                      groupLabel={group.groupLabel ?? 'This group'}
                      variant="link"
                    />
                    <DeleteEntityButton
                      entity="registration"
                      id={group.registrationId}
                      name={`the group "${group.groupLabel}"`}
                      label="Delete group"
                      refundable
                      className="text-xs font-medium text-red-600 hover:text-red-800"
                    />
                  </>
                ) : undefined
                /* Individual registrations need no header actions — the per-row
                   "Delete Registration" removes the participant and auto-withdraws
                   the emptied registration. */
              }
            >
              {/* The group's teacher and school, each linked to its record. The
                  header can't hold links: the whole header is the fold button. */}
              {group.type === 'group' && (group.teacherName || group.schoolName) && (
                <p className="flex flex-wrap gap-x-4 gap-y-1 border-b border-line-light bg-white px-4 py-2 text-xs text-content-muted">
                  {group.teacherName && (
                    <span>
                      Teacher:{' '}
                      <MemberLink memberId={group.teacherMemberId} className="font-medium text-content-body">
                        {group.teacherName}
                      </MemberLink>
                    </span>
                  )}
                  {group.schoolName && (
                    <span>
                      School:{' '}
                      <SchoolLink schoolId={group.schoolId} className="font-medium text-content-body">
                        {group.schoolName}
                      </SchoolLink>
                    </span>
                  )}
                </p>
              )}
              {/* Below lg: one card per participant. */}
              <ul className="divide-y divide-line-light bg-white lg:hidden">
                {group.participants.map((p) => (
                  <li key={p.id} className="space-y-3 px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="font-subheading text-base font-semibold text-ink">
                          <MemberLink memberId={p.member_id}>
                            {p.first_name} {p.last_name}
                          </MemberLink>
                        </h4>
                        <p className="truncate text-xs text-content-muted" title={p.email}>
                          {p.email}
                        </p>
                      </div>
                      <span className="shrink-0">{statusPill(p)}</span>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
                      <CardField label="Role">{displayEventRole(p.event_role) ?? p.event_role ?? '—'}</CardField>
                      <CardField label="School">
                        {p.school_name ? <SchoolLink schoolId={p.school_id}>{p.school_name}</SchoolLink> : '—'}
                      </CardField>
                      <CardField label="Grade">{displayGrade(p.grade) ?? '—'}</CardField>
                      <CardField label="Shirt">{p.t_shirt_size ?? '—'}</CardField>
                      <CardField label="Payment">{paymentCell(p)}</CardField>
                      <CardField label="DocuSign">{docusignCell(p)}</CardField>
                      <CardField label="Background">
                        <Pill {...COMPLIANCE_PILLS[p.compliance_pill]} />
                      </CardField>
                    </dl>
                    {placeable(p) && companies.length > 0 && (
                      <label className="block">
                        <span className="mb-1 block text-xs text-content-muted">Company</span>
                        {companySelect(p, 'input-field disabled:opacity-50')}
                      </label>
                    )}
                    {/* [&>button]:text-sm: CorrectSignerEmailButton keeps its
                        own text-xs, which outranks TAP's text-sm in the CSS. */}
                    <div className="flex flex-wrap gap-2 [&>button]:text-sm">{rowActions(group, p, true)}</div>
                  </li>
                ))}
              </ul>

              {/* From lg up: the table. */}
              <div
                role="region"
                aria-label={
                  group.type === 'group'
                    ? `Group roster: ${group.groupLabel}`
                    : `Individual registration: ${group.participants.map((p) => `${p.first_name} ${p.last_name}`).join(', ')}`
                }
                tabIndex={0}
                className="hidden relative overflow-x-auto bg-white focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary lg:block"
              >
                <table className="w-full min-w-[theme(maxWidth.content)] table-fixed border-separate border-spacing-0 text-sm">
                  <colgroup>
                    {COLUMNS.map((c) => (
                      <col key={c.label} style={{ width: c.width }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr className="text-left">
                      {COLUMNS.map((c, i) => (
                        <th
                          key={c.label}
                          scope="col"
                          className={`border-b border-line-light px-4 py-2 font-medium text-brand-muted-soft text-xs uppercase tracking-wide ${
                            c.label === 'Actions' ? 'text-right' : ''
                          } ${i === 0 ? `${STICKY} bg-white` : ''}`}
                        >
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {group.participants.map((p) => (
                      <tr key={p.id} className="group hover:bg-brand-canvas">
                        <td className={`${TD} ${STICKY} bg-white group-hover:bg-brand-canvas`}>
                          <MemberLink memberId={p.member_id} className="font-medium text-brand-blue-dark">
                            {p.first_name} {p.last_name}
                          </MemberLink>
                          <p className="text-xs text-brand-muted-soft truncate" title={p.email}>
                            {p.email}
                          </p>
                        </td>
                        <td className={`${TD} text-brand-muted`}>{displayEventRole(p.event_role) ?? p.event_role ?? '—'}</td>
                        <td className={`${TD} text-brand-muted`}>
                          {p.school_name ? <SchoolLink schoolId={p.school_id}>{p.school_name}</SchoolLink> : '—'}
                        </td>
                        <td className={`${TD} text-brand-muted`}>{displayGrade(p.grade) ?? '—'}</td>
                        <td className={`${TD} text-brand-muted`}>{p.t_shirt_size ?? '—'}</td>
                        <td className={TD}>
                          {placeable(p) ? (
                            companies.length === 0 ? (
                              <span className="text-brand-muted-soft">—</span>
                            ) : (
                              companySelect(
                                p,
                                'border border-brand-border rounded px-2 py-1 text-xs bg-white text-brand-muted disabled:opacity-50 max-w-full',
                              )
                            )
                          ) : (
                            <span className="text-brand-muted-soft">n/a</span>
                          )}
                        </td>
                        <td className={TD}>{paymentCell(p)}</td>
                        <td className={TD}>{docusignCell(p)}</td>
                        <td className={TD}>
                          <Pill {...COMPLIANCE_PILLS[p.compliance_pill]} />
                        </td>
                        <td className={TD}>{statusPill(p)}</td>
                        <td className={`${TD} text-right space-x-3`}>{rowActions(group, p, false)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Collapsible>
          ))}
        </div>
      )}
    </CollapsibleGroup>
    </Collapsible>
  )
}

// The folded header line for one registration: what needs chasing, at a glance.
function groupSummary(participants: RosterParticipant[]): string {
  const n = participants.length
  const unpaid = participants.filter((p) => !p.paid).length
  const docusign = participants.filter((p) => p.docusign === 'outstanding').length
  const background = participants.filter((p) => OUTSTANDING_STATES.includes(p.compliance_pill)).length
  const checkedIn = participants.filter((p) => p.checked_in_at).length
  const open = [
    unpaid && `${unpaid} unpaid`,
    docusign && `${docusign} DocuSign open`,
    background && `${background} background open`,
  ].filter(Boolean)
  return [
    `${n} participant${n === 1 ? '' : 's'}`,
    ...(open.length ? open : ['all clear']),
    checkedIn ? `${checkedIn} checked in` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

// One labelled value on a participant card.
function CardField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-content-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-content-body">{children}</dd>
    </div>
  )
}

// "Scholarship · 50%" — marks a registration held under a scholarship.
function ScholarshipBadge({ percent, refundCents }: { percent: number; refundCents?: number | null }) {
  return (
    <span className="inline-flex items-center rounded-full bg-pathway-amber-bg px-2 py-0.5 text-xs font-semibold normal-case tracking-normal text-ink">
      Scholarship · {percent}%
      {refundCents ? ` · $${(refundCents / 100).toFixed(2)} reimbursed` : ''}
    </span>
  )
}
