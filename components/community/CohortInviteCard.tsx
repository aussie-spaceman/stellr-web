'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Mail } from 'lucide-react'

// A pending cohort invitation a member can accept or decline (PRD §11).
export function CohortInviteCard({ cohortId, name }: { cohortId: string; name: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const respond = async (action: 'accept' | 'decline') => {
    setBusy(true)
    try {
      const res = await fetch('/api/community/cohorts/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cohortId, action }),
      })
      if (res.ok) router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-indigo-200 bg-indigo-50/50 p-4">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-indigo-500" />
        <div>
          <p className="font-medium text-gray-900">{name}</p>
          <p className="text-xs text-gray-500">You&apos;ve been invited to this mentoring cohort.</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => respond('accept')}
          disabled={busy}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          Accept
        </button>
        <button
          onClick={() => respond('decline')}
          disabled={busy}
          className="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
        >
          Decline
        </button>
      </div>
    </div>
  )
}
