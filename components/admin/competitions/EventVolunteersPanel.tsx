'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { X, HandHeart, UserCheck } from 'lucide-react'
import MemberPicker, { type PickedMember } from '@/components/admin/MemberPicker'

interface VolunteerRow {
  memberId: string
  firstName: string | null
  lastName: string | null
  email: string | null
  since: string
  agreement: 'complete' | 'in_flight' | 'missing'
  compliance: string
  complianceDetail: string | null
}

interface PanelData {
  interested: VolunteerRow[]
  assigned: VolunteerRow[]
}

function Pill({ tone, label, title }: { tone: 'green' | 'amber' | 'red'; label: string; title?: string }) {
  const cls = {
    green: 'bg-green-100 text-green-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-red-100 text-red-700',
  }[tone]
  return (
    <span title={title} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  )
}

function AgreementPill({ v }: { v: VolunteerRow['agreement'] }) {
  if (v === 'complete') return <Pill tone="green" label="Agreement signed" />
  if (v === 'in_flight') return <Pill tone="amber" label="Agreement sent" />
  return <Pill tone="red" label="No agreement" />
}

function CompliancePill({ state, detail }: { state: string; detail: string | null }) {
  if (state === 'valid_bc' || state === 'valid_license') return <Pill tone="green" label="Cleared" title={detail ?? undefined} />
  if (state === 'in_process') return <Pill tone="amber" label="Check in progress" title={detail ?? undefined} />
  if (state === 'not_required') return <Pill tone="green" label="No check needed" />
  return <Pill tone="red" label="Not cleared" title={detail ?? undefined} />
}

// Event Volunteers panel (PRD §15). Shows volunteers who offered to support this
// event and those already assigned. Assignment is manual and warn-don't-block:
// missing paperwork / clearance shows as red pills but never disables the button.
export function EventVolunteersPanel({ slug }: { slug: string }) {
  const [data, setData] = useState<PanelData>({ interested: [], assigned: [] })
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = async () => {
    const res = await fetch(`/api/admin/events/${slug}/volunteers`)
    if (res.ok) setData(await res.json())
    setLoaded(true)
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const post = async (method: 'POST' | 'DELETE', memberId: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/events/${slug}/volunteers`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId }),
      })
      if (res.ok) await load()
    } finally {
      setBusy(false)
    }
  }

  const name = (m: VolunteerRow) => [m.firstName, m.lastName].filter(Boolean).join(' ') || 'Member'

  const row = (m: VolunteerRow, action: ReactNode) => (
    <li
      key={m.memberId}
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-hairline px-3 py-1.5 text-sm"
    >
      <span className="min-w-0">
        <span className="font-medium text-brand-blue-dark">{name(m)}</span>
        {m.email && <span className="ml-2 text-xs text-brand-muted-soft">{m.email}</span>}
      </span>
      <span className="flex items-center gap-1.5">
        <AgreementPill v={m.agreement} />
        <CompliancePill state={m.compliance} detail={m.complianceDetail} />
        {action}
      </span>
    </li>
  )

  return (
    <div className="rounded-xl border border-brand-border bg-white p-5">
      <div className="mb-1 flex items-center gap-2">
        <HandHeart className="h-4 w-4 text-brand-blue" />
        <h2 className="font-semibold text-brand-blue-dark">Volunteers</h2>
      </div>
      <p className="mb-3 text-xs text-brand-muted-soft">
        Volunteers who offered to support this event, and those you&apos;ve assigned. Red pills flag
        missing paperwork or clearance — they warn, but don&apos;t block assignment.
      </p>

      <MemberPicker onPick={(m: PickedMember) => post('POST', m.id)} disabled={busy} placeholder="Assign any member as a volunteer…" />

      <h3 className="mt-4 mb-1.5 text-xs font-semibold uppercase tracking-wide text-brand-muted">
        Offered to help
      </h3>
      <ul className="space-y-1.5">
        {loaded && data.interested.length === 0 && (
          <li className="text-xs text-brand-muted-soft">No volunteer offers yet.</li>
        )}
        {data.interested.map((m) =>
          row(
            m,
            <button
              onClick={() => post('POST', m.memberId)}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg bg-brand-blue px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
            >
              <UserCheck className="h-3.5 w-3.5" /> Assign
            </button>,
          ),
        )}
      </ul>

      <h3 className="mt-4 mb-1.5 text-xs font-semibold uppercase tracking-wide text-brand-muted">
        Assigned
      </h3>
      <ul className="space-y-1.5">
        {loaded && data.assigned.length === 0 && (
          <li className="text-xs text-brand-muted-soft">No volunteers assigned yet.</li>
        )}
        {data.assigned.map((m) =>
          row(
            m,
            <button
              onClick={() => post('DELETE', m.memberId)}
              disabled={busy}
              aria-label={`Remove ${name(m)} from this event`}
              className="text-brand-muted-soft hover:text-red-600 disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>,
          ),
        )}
      </ul>
    </div>
  )
}
