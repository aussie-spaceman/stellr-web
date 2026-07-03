'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { UserPlus, FileSignature, ShieldCheck, X } from 'lucide-react'
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

export function VolunteersConsole({ rows }: { rows: VolunteerConsoleRow[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

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

  const addVolunteer = (m: PickedMember) =>
    call(m.id, `/api/admin/members/${m.id}/volunteer`, 'POST', 'Volunteer added')

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
          Grants the additive volunteer role and adds the member to the Volunteer Hub space. New
          volunteers who sign up via the public page appear here automatically. Use &ldquo;Issue
          agreement&rdquo; after adding someone manually.
        </p>
        <MemberPicker onPick={addVolunteer} disabled={busy !== null} placeholder="Make a member a volunteer…" />
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
    </div>
  )
}
