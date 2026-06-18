'use client'

import { useEffect, useState } from 'react'
import { X, Trophy, GraduationCap, MessagesSquare } from 'lucide-react'

const KEY = 'stellr.home.welcome.dismissed'

// First-run welcome on the Home dashboard (Stage 4). Shows once, then is
// dismissed for good via localStorage. Purely additive — no data.
export function WelcomeBanner({ firstName }: { firstName: string }) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setShow(true)
    } catch {
      /* localStorage unavailable — just don't show */
    }
  }, [])

  if (!show) return null

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* ignore */
    }
    setShow(false)
  }

  return (
    <div className="relative mb-[18px] overflow-hidden rounded-card-lg border border-brand-border bg-white p-5 shadow-card">
      <button
        onClick={dismiss}
        aria-label="Dismiss welcome"
        className="absolute right-3 top-3 rounded-md p-1 text-brand-muted-soft transition hover:bg-brand-hairline hover:text-brand-muted"
      >
        <X className="h-4 w-4" />
      </button>
      <p className="font-subheading text-sm font-semibold text-brand-blue-dark">
        Welcome to Stellr, {firstName} 🎉
      </p>
      <p className="mt-1 max-w-2xl text-sm text-brand-muted">
        This is your home base. Here&apos;s what you&apos;ll find — use the sidebar to jump anywhere.
      </p>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-brand-muted">
        <span className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-brand-orange-alt" /> Your next competition &amp; prep
        </span>
        <span className="flex items-center gap-2">
          <GraduationCap className="h-4 w-4 text-brand-orange" /> Training to finish
        </span>
        <span className="flex items-center gap-2">
          <MessagesSquare className="h-4 w-4 text-brand-blue" /> What&apos;s new in your spaces
        </span>
      </div>
    </div>
  )
}
