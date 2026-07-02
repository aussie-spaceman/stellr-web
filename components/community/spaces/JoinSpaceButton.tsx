'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/components/ui/Toast'

// Join CTA on an open Discover card. Joins the space (active roster row), keeps
// the member on the directory with a "Go to space →" toast, and refreshes so the
// card moves into "Your spaces" and the member count updates.
export function JoinSpaceButton({ spaceSlug, spaceName }: { spaceSlug: string; spaceName: string }) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'joining' | 'joined'>('idle')

  async function join(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (state !== 'idle') return
    setState('joining')
    try {
      const res = await fetch('/api/community/spaces/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spaceSlug }),
      })
      if (res.ok) {
        setState('joined')
        toast(`You've joined ${spaceName}`, {
          action: { label: 'Go to space →', href: `/community/${spaceSlug}` },
        })
        router.refresh()
      } else {
        setState('idle')
        toast("Couldn't join — please try again.", { tone: 'error' })
      }
    } catch {
      setState('idle')
      toast("Couldn't join — please try again.", { tone: 'error' })
    }
  }

  return (
    <button
      onClick={join}
      disabled={state !== 'idle'}
      className="rounded-full bg-brand-blue px-3 py-1 text-[11px] font-subheading font-semibold text-white transition hover:bg-brand-blue-dark disabled:opacity-60"
    >
      {state === 'joining' ? 'Joining…' : state === 'joined' ? 'Joined ✓' : 'Join'}
    </button>
  )
}
