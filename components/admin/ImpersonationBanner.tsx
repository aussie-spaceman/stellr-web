'use client'

import { useState } from 'react'
import { Eye } from 'lucide-react'

// Sticky banner shown across the WHOLE member portal while an admin is viewing
// as a member. It names both people on purpose: the Clerk <UserButton> in the
// top bar still shows the ADMIN's avatar (their session is untouched), so
// without this an admin can easily believe they are in the wrong account — or
// worse, forget they are in someone else's.

export function ImpersonationBanner({
  memberName,
  adminName,
  memberId,
}: {
  memberName: string
  adminName: string | null
  memberId: string
}) {
  const [exiting, setExiting] = useState(false)

  const exit = async () => {
    setExiting(true)
    try {
      await fetch('/api/admin/impersonation', { method: 'DELETE' })
    } finally {
      // Full navigation, not router.push: every server component on the way out
      // must re-resolve without the cookie.
      window.location.href = `/admin/members/${memberId}`
    }
  }

  return (
    <div className="sticky top-0 z-50 border-b border-amber-300 bg-amber-100 px-4 py-2.5 print:hidden">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm text-amber-900">
          <Eye className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            {adminName ? <strong>{adminName}</strong> : 'You'} are viewing the portal as{' '}
            <strong>{memberName}</strong> — read only. Changes are blocked.
          </span>
        </span>
        <button
          onClick={exit}
          disabled={exiting}
          className="shrink-0 rounded-lg border border-amber-400 bg-white px-3 py-1 text-sm font-semibold text-amber-900 hover:bg-amber-50 disabled:opacity-60"
        >
          {exiting ? 'Exiting…' : 'Exit view-as'}
        </button>
      </div>
    </div>
  )
}
