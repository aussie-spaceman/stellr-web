'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function InviteActions({ cohortId }: { cohortId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<null | 'accept' | 'decline'>(null)

  const respond = async (action: 'accept' | 'decline') => {
    setBusy(action)
    try {
      const res = await fetch('/api/community/cohorts/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cohortId, action }),
      })
      if (res.ok) {
        router.push(action === 'accept' ? `/community/mentoring/${cohortId}` : '/community/mentoring')
        router.refresh()
      } else {
        setBusy(null)
      }
    } catch {
      setBusy(null)
    }
  }

  return (
    <div className="flex items-center gap-3 pt-1">
      <button
        onClick={() => respond('accept')}
        disabled={busy !== null}
        className="flex-1 rounded-[9px] bg-space-violet px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#5B3FE0] disabled:opacity-50"
      >
        {busy === 'accept' ? 'Joining…' : 'Accept & join cohort'}
      </button>
      <button
        onClick={() => respond('decline')}
        disabled={busy !== null}
        className="rounded-[9px] border border-line px-5 py-3 text-sm font-semibold text-content-secondary transition-colors hover:border-danger hover:text-danger disabled:opacity-50"
      >
        {busy === 'decline' ? 'Declining…' : 'Decline'}
      </button>
    </div>
  )
}
