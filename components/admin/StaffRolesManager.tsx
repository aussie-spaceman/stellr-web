'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import MemberPicker, { type PickedMember } from '@/components/admin/MemberPicker'

export interface StaffRole {
  member_id: string
  member_name: string | null
  member_email: string | null
  scopes: string[]
}

// Function-scoped staff (the platform RBAC seam, D10). Platform admins are set in
// Clerk and implicitly hold every scope; this screen grants narrower scopes to
// members (e.g. a future Graduations coordinator) without making them full admins.
export default function StaffRolesManager({
  initial,
  allScopes,
}: {
  initial: StaffRole[]
  allScopes: string[]
}) {
  const router = useRouter()
  const grantable = allScopes.filter((s) => s !== 'all')
  const [member, setMember] = useState<PickedMember | null>(null)
  const [scopes, setScopes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const memberName = member
    ? [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email || 'Member'
    : ''

  const toggle = (s: string) =>
    setScopes((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]))

  async function grant() {
    if (!member || scopes.length === 0) return
    setBusy(true)
    setError(null)
    const res = await fetch('/api/admin/staff-roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: member.id, scopes }),
    })
    setBusy(false)
    if (!res.ok) {
      const b = await res.json().catch(() => null)
      setError(b?.error ?? 'Failed to save')
      return
    }
    setMember(null)
    setScopes([])
    router.refresh()
  }

  async function remove(memberId: string) {
    setBusy(true)
    await fetch('/api/admin/staff-roles', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId }),
    })
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-brand-border bg-brand-canvas p-3 text-xs text-brand-muted-soft">
        Full platform admins are configured in Clerk (role metadata) and implicitly hold every scope.
        Use this to give a member a narrower set of staff scopes without making them a full admin.
      </div>

      <div className="rounded-xl border border-brand-border bg-white p-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-brand-muted-soft">Grant scopes</p>
        <div className="mb-3">
          {member ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-blue/5 py-1 pl-3 pr-1 text-sm font-medium text-brand-blue">
              {memberName}
              <button onClick={() => setMember(null)} aria-label="Clear member" className="hover:text-brand-blue">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ) : (
            <MemberPicker disabled={busy} onPick={setMember} />
          )}
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          {grantable.map((s) => (
            <button
              key={s}
              onClick={() => toggle(s)}
              className={`rounded-full border px-3 py-1 text-xs font-medium capitalize ${
                scopes.includes(s)
                  ? 'border-brand-blue bg-brand-blue/5 text-brand-blue'
                  : 'border-brand-border bg-white text-brand-muted hover:bg-brand-canvas'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          onClick={grant}
          disabled={busy || !member || scopes.length === 0}
          className="rounded-md bg-brand-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
        >
          Save
        </button>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>

      <div className="overflow-hidden rounded-xl border border-brand-border bg-white">
        {initial.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-brand-muted-soft">No scoped staff yet.</p>
        )}
        {initial.map((r) => (
          <div
            key={r.member_id}
            className="flex items-center justify-between gap-3 border-b border-brand-hairline px-4 py-3 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-brand-blue-dark">
                {r.member_name?.trim() || r.member_email || 'Member'}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {r.scopes.map((s) => (
                  <span
                    key={s}
                    className="rounded bg-brand-hairline px-1.5 py-0.5 text-[11px] font-medium capitalize text-brand-muted"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
            <button
              onClick={() => remove(r.member_id)}
              disabled={busy}
              aria-label="Remove staff role"
              className="shrink-0 text-brand-muted-soft hover:text-brand-muted disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
