'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Join CTA on an open Discover card. Joins the space (active roster row) then
// refreshes so the card moves into "Your spaces" and the member count updates.
export function JoinSpaceButton({ spaceSlug }: { spaceSlug: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function join(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/community/spaces/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spaceSlug }),
      })
      if (res.ok) router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={join}
      disabled={busy}
      className="rounded-full bg-brand-blue px-3 py-1 text-[11px] font-subheading font-semibold text-white transition hover:bg-brand-blue-dark disabled:opacity-60"
    >
      {busy ? 'Joining…' : 'Join'}
    </button>
  )
}
