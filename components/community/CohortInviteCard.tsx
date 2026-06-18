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
    <div className="flex items-center justify-between gap-3 rounded-lg border border-brand-blue bg-brand-blue/5/50 p-4">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-brand-blue" />
        <div>
          <p className="font-medium text-brand-blue-dark">{name}</p>
          <p className="text-xs text-brand-muted-soft">You&apos;ve been invited to this mentoring cohort.</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => respond('accept')}
          disabled={busy}
          className="rounded-md bg-brand-blue-dark px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
        >
          Accept
        </button>
        <button
          onClick={() => respond('decline')}
          disabled={busy}
          className="rounded-md px-3 py-1.5 text-sm text-brand-muted-soft hover:text-brand-muted disabled:opacity-50"
        >
          Decline
        </button>
      </div>
    </div>
  )
}
