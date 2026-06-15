'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'

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
  const [email, setEmail] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (s: string) =>
    setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]))

  async function grant() {
    if (!email.trim() || picked.length === 0) return
    setBusy(true)
    setError(null)
    const res = await fetch('/api/admin/staff-roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), scopes: picked }),
    })
    setBusy(false)
    if (!res.ok) {
      const b = await res.json().catch(() => null)
      setError(b?.error ?? 'Failed to save')
      return
    }
    setEmail('')
    setPicked([])
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
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
        Full platform admins are configured in Clerk (role metadata) and implicitly hold every scope.
        Use this to give a member a narrower set of staff scopes without making them a full admin.
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Grant scopes</p>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="member@email.com"
          className="mb-3 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
        <div className="mb-3 flex flex-wrap gap-2">
          {grantable.map((s) => (
            <button
              key={s}
              onClick={() => toggle(s)}
              className={`rounded-full border px-3 py-1 text-xs font-medium capitalize ${
                picked.includes(s)
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                  : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          onClick={grant}
          disabled={busy || !email.trim() || picked.length === 0}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Save
        </button>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {initial.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-gray-400">No scoped staff yet.</p>
        )}
        {initial.map((r) => (
          <div
            key={r.member_id}
            className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">
                {r.member_name?.trim() || r.member_email || 'Member'}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {r.scopes.map((s) => (
                  <span
                    key={s}
                    className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium capitalize text-gray-600"
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
              className="shrink-0 text-gray-400 hover:text-gray-700 disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
