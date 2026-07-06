'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { UserPlus, FileSignature, ShieldCheck, X, CalendarPlus } from 'lucide-react'
import MemberPicker, { type PickedMember } from '@/components/admin/MemberPicker'

export interface VolunteerConsoleRow {
  memberId: string
  firstName: string | null
  lastName: string | null
  email: string | null
  ageBracket: string | null
  isActive: boolean
  agreement: 'complete' | 'in_flight' | 'missing'
  compliance: string
  complianceDetail: string | null
  training: { completed: number; total: number }
  assignments: string[]
  interestCount: number
}

export interface AssignableEvent {
  slug: string
  title: string
  kind: 'event' | 'campaign'
}

function Pill({ tone, label, title }: { tone: 'green' | 'amber' | 'red' | 'grey'; label: string; title?: string }) {
  const cls = {
    green: 'bg-green-100 text-green-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-red-100 text-red-700',
    grey: 'bg-brand-hairline text-brand-muted-soft',
  }[tone]
  return (
    <span title={title} className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  )
}

// Multi-select checklist of events/campaigns a volunteer can be assigned to.
function EventChecklist({
  events,
  selected,
  onToggle,
}: {
  events: AssignableEvent[]
  selected: Set<string>
  onToggle: (slug: string) => void
}) {
  const [q, setQ] = useState('')
  const filtered = events.filter((e) => e.title.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="rounded-lg border border-brand-border">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter events & campaigns…"
        className="w-full rounded-t-lg border-b border-brand-hairline px-3 py-2 text-sm focus:outline-none"
      />
      <div className="max-h-52 overflow-y-auto p-1">
        {filtered.length === 0 && (
          <p className="px-2 py-3 text-center text-xs text-brand-muted-soft">No matching events.</p>
        )}
        {filtered.map((e) => (
          <label
            key={e.slug}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-brand-canvas"
          >
            <input type="checkbox" checked={selected.has(e.slug)} onChange={() => onToggle(e.slug)} />
            <span className="min-w-0 flex-1 truncate text-brand-blue-dark">{e.title}</span>
            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${e.kind === 'campaign' ? 'bg-amber-100 text-amber-700' : 'bg-brand-blue/10 text-brand-blue'}`}>
              {e.kind}
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}

export function VolunteersConsole({ rows, events }: { rows: VolunteerConsoleRow[]; events: AssignableEvent[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  // Add-a-volunteer staging: pick the member, optionally pick events, then submit.
  const [staged, setStaged] = useState<PickedMember | null>(null)
  const [addEvents, setAddEvents] = useState<Set<string>>(new Set())
  // Per-row "assign to more events" target.
  const [assignTarget, setAssignTarget] = useState<VolunteerConsoleRow | null>(null)
  const [assignEvents, setAssignEvents] = useState<Set<string>>(new Set())

  async function call(memberId: string, path: string, method: 'POST' | 'DELETE', okMessage: string) {
    setBusy(memberId)
    setNotice('')
    try {
      const res = await fetch(path, { method })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNotice(data.error ?? 'Something went wrong')
        return
      }
      setNotice(okMessage)
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  // Assign a member to each selected event (a volunteer can cover several). Each
  // POST also grants the volunteer role + syncs Spaces, so this is safe whether
  // or not the member is already a volunteer. Returns how many succeeded.
  async function assignToEvents(memberId: string, slugs: string[]): Promise<number> {
    let ok = 0
    for (const slug of slugs) {
      const res = await fetch(`/api/admin/events/${slug}/volunteers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId }),
      })
      if (res.ok) ok += 1
    }
    return ok
  }

  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>) => (slug: string) =>
    set((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })

  async function submitAdd() {
    if (!staged) return
    const memberId = staged.id
    const slugs = [...addEvents]
    setBusy(memberId)
    setNotice('')
    try {
      // Always grant the volunteer role (covers the no-event case too).
      const res = await fetch(`/api/admin/members/${memberId}/volunteer`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setNotice(data.error ?? 'Could not add volunteer')
        return
      }
      const assigned = slugs.length > 0 ? await assignToEvents(memberId, slugs) : 0
      setNotice(
        slugs.length > 0
          ? `Volunteer added and assigned to ${assigned} event${assigned === 1 ? '' : 's'}`
          : 'Volunteer added'
      )
      setStaged(null)
      setAddEvents(new Set())
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  async function submitAssign() {
    if (!assignTarget) return
    const slugs = [...assignEvents]
    if (slugs.length === 0) { setAssignTarget(null); return }
    setBusy(assignTarget.memberId)
    setNotice('')
    try {
      const assigned = await assignToEvents(assignTarget.memberId, slugs)
      setNotice(`Assigned to ${assigned} event${assigned === 1 ? '' : 's'}`)
      setAssignTarget(null)
      setAssignEvents(new Set())
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  const removeVolunteer = (r: VolunteerConsoleRow) => {
    if (!window.confirm(`Remove ${name(r)} from the volunteer program?`)) return
    call(r.memberId, `/api/admin/members/${r.memberId}/volunteer`, 'DELETE', 'Volunteer removed')
  }

  const issueAgreement = (r: VolunteerConsoleRow) =>
    call(r.memberId, `/api/admin/members/${r.memberId}/volunteer-agreement`, 'POST', 'Volunteer Agreement sent')

  const orderCheck = (r: VolunteerConsoleRow) =>
    call(r.memberId, `/api/admin/members/${r.memberId}/background-check`, 'POST', 'Background check ordered')

  const name = (r: VolunteerConsoleRow) =>
    [r.firstName, r.lastName].filter(Boolean).join(' ') || 'Member'

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-brand-border bg-white p-5">
        <div className="mb-1 flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-brand-blue" />
          <h2 className="font-semibold text-brand-blue-dark">Add a volunteer</h2>
        </div>
        <p className="mb-3 text-xs text-brand-muted-soft">
          Grants the additive volunteer role and adds the member to the Volunteer Hub space. Optionally
          assign them to one or more events — a volunteer can cover several. New volunteers who sign up
          via the public page appear here automatically.
        </p>

        {!staged ? (
          <MemberPicker onPick={setStaged} disabled={busy !== null} placeholder="Make a member a volunteer…" />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-brand-blue/10 px-3 py-1 text-sm font-medium text-brand-blue-dark">
                {[staged.first_name, staged.last_name].filter(Boolean).join(' ') || staged.email || 'Member'}
              </span>
              <button
                onClick={() => { setStaged(null); setAddEvents(new Set()) }}
                disabled={busy !== null}
                className="text-brand-muted-soft hover:text-brand-muted disabled:opacity-50"
                aria-label="Clear selected member"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-muted-soft">
                Assign to events <span className="font-normal normal-case text-brand-muted-soft">(optional)</span>
              </p>
              {events.length === 0 ? (
                <p className="text-xs text-brand-muted-soft">No events available to assign.</p>
              ) : (
                <EventChecklist events={events} selected={addEvents} onToggle={toggle(setAddEvents)} />
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={submitAdd}
                disabled={busy !== null}
                className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-bright disabled:opacity-50"
              >
                {busy ? 'Adding…' : addEvents.size > 0 ? `Add volunteer & assign to ${addEvents.size}` : 'Add volunteer'}
              </button>
              <button
                onClick={() => { setStaged(null); setAddEvents(new Set()) }}
                disabled={busy !== null}
                className="px-2 py-2 text-sm text-brand-muted-soft hover:text-brand-muted disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {notice && <p className="mt-2 text-xs text-brand-muted">{notice}</p>}
      </div>

      <div className="overflow-x-auto rounded-xl border border-brand-border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-brand-hairline text-left text-xs uppercase tracking-wide text-brand-muted-soft">
              <th className="px-4 py-3">Volunteer</th>
              <th className="px-4 py-3">Agreement</th>
              <th className="px-4 py-3">Background check</th>
              <th className="px-4 py-3">Training</th>
              <th className="px-4 py-3">Events</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-brand-muted-soft">
                  No volunteers yet. Add one above, or share the public volunteer signup page.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.memberId} className="border-b border-brand-hairline last:border-0">
                <td className="px-4 py-3">
                  <Link href={`/admin/members/${r.memberId}`} className="font-medium text-brand-blue-dark hover:underline">
                    {name(r)}
                  </Link>
                  <div className="text-xs text-brand-muted-soft">{r.email}</div>
                </td>
                <td className="px-4 py-3">
                  {r.agreement === 'complete' && <Pill tone="green" label="Signed" />}
                  {r.agreement === 'in_flight' && <Pill tone="amber" label="Sent" />}
                  {r.agreement === 'missing' && <Pill tone="red" label="Missing" />}
                </td>
                <td className="px-4 py-3">
                  {(r.compliance === 'valid_bc' || r.compliance === 'valid_license') && (
                    <Pill tone="green" label="Cleared" title={r.complianceDetail ?? undefined} />
                  )}
                  {r.compliance === 'in_process' && (
                    <Pill tone="amber" label="In progress" title={r.complianceDetail ?? undefined} />
                  )}
                  {!['valid_bc', 'valid_license', 'in_process'].includes(r.compliance) && (
                    <Pill tone="red" label="Not cleared" title={r.complianceDetail ?? undefined} />
                  )}
                </td>
                <td className="px-4 py-3">
                  {r.training.total === 0 ? (
                    <Pill tone="grey" label="No course set" />
                  ) : r.training.completed >= r.training.total ? (
                    <Pill tone="green" label="Complete" />
                  ) : (
                    <Pill tone="amber" label={`${r.training.completed}/${r.training.total} lessons`} />
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className="text-brand-blue-dark tabular-nums">{r.assignments.length}</span>
                  <span className="text-xs text-brand-muted-soft"> assigned</span>
                  {r.interestCount > 0 && (
                    <div className="text-xs text-brand-muted-soft">{r.interestCount} offer{r.interestCount === 1 ? '' : 's'} open</div>
                  )}
                  {r.assignments.length > 0 && (
                    <div className="max-w-[220px] truncate text-xs text-brand-muted-soft" title={r.assignments.join(', ')}>
                      {r.assignments.join(', ')}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => { setAssignTarget(r); setAssignEvents(new Set()); setNotice('') }}
                      disabled={busy !== null || events.length === 0}
                      title="Assign to one or more events"
                      className="inline-flex items-center gap-1 rounded-lg border border-brand-border px-2 py-1 text-xs font-medium text-brand-muted hover:border-brand-blue hover:text-brand-blue disabled:opacity-50"
                    >
                      <CalendarPlus className="h-3.5 w-3.5" /> Assign
                    </button>
                    <button
                      onClick={() => issueAgreement(r)}
                      disabled={busy !== null}
                      title="Issue / re-issue the Volunteer Agreement"
                      className="inline-flex items-center gap-1 rounded-lg border border-brand-border px-2 py-1 text-xs font-medium text-brand-muted hover:border-brand-blue hover:text-brand-blue disabled:opacity-50"
                    >
                      <FileSignature className="h-3.5 w-3.5" /> Agreement
                    </button>
                    <button
                      onClick={() => orderCheck(r)}
                      disabled={busy !== null}
                      title="Order a background check"
                      className="inline-flex items-center gap-1 rounded-lg border border-brand-border px-2 py-1 text-xs font-medium text-brand-muted hover:border-brand-blue hover:text-brand-blue disabled:opacity-50"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" /> Check
                    </button>
                    <button
                      onClick={() => removeVolunteer(r)}
                      disabled={busy !== null}
                      title="Remove from the volunteer program"
                      aria-label={`Remove ${name(r)} from the volunteer program`}
                      className="text-brand-muted-soft hover:text-red-600 disabled:opacity-50"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Per-row assign-to-events modal */}
      {assignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => busy === null && setAssignTarget(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-brand-blue-dark">Assign {name(assignTarget)} to events</h3>
              <button onClick={() => setAssignTarget(null)} disabled={busy !== null} className="text-brand-muted-soft hover:text-brand-muted disabled:opacity-50">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 text-xs text-brand-muted-soft">Select one or more events. Already-assigned events are left unchanged.</p>
            <EventChecklist events={events} selected={assignEvents} onToggle={toggle(setAssignEvents)} />
            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={submitAssign}
                disabled={busy !== null || assignEvents.size === 0}
                className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-bright disabled:opacity-50"
              >
                {busy ? 'Assigning…' : `Assign to ${assignEvents.size || ''}`.trim()}
              </button>
              <button onClick={() => setAssignTarget(null)} disabled={busy !== null} className="px-2 py-2 text-sm text-brand-muted-soft hover:text-brand-muted disabled:opacity-50">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
