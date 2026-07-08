'use client'

import { useState } from 'react'
import { Flag, Check } from 'lucide-react'

// Lets a member report that a training lesson's resource is unavailable/broken.
// Posts to the flag route which alerts community admins (in-app + email).
export function FlagResourceButton({ itemId }: { itemId: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')

  async function flag() {
    setState('sending')
    try {
      const res = await fetch(`/api/community/training/${itemId}/flag`, { method: 'POST' })
      if (!res.ok) throw new Error('failed')
      setState('done')
    } catch {
      setState('error')
    }
  }

  if (state === 'done') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-white/80">
        <Check className="h-4 w-4" /> Reported — thanks, an admin will take a look.
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={flag}
      disabled={state === 'sending'}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/30 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-60"
    >
      <Flag className="h-4 w-4" />
      {state === 'sending' ? 'Reporting…' : state === 'error' ? 'Try again' : 'Flag issue with an administrator'}
    </button>
  )
}
