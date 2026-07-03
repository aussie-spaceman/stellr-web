'use client'

import { useState } from 'react'
import { HandHeart, Check } from 'lucide-react'

interface Props {
  eventSlug: string
  /** Whether the member has already offered to help with this event. */
  initialInterested: boolean
}

/**
 * "Volunteer to help" toggle shown to volunteer-role members under catalog
 * cards. Raising a hand is an interest signal only — admins confirm the
 * assignment manually from the event's Volunteers panel.
 */
export function VolunteerInterestButton({ eventSlug, initialInterested }: Props) {
  const [interested, setInterested] = useState(initialInterested)
  const [busy, setBusy] = useState(false)

  async function toggle() {
    setBusy(true)
    const next = !interested
    try {
      const res = await fetch('/api/volunteer/interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventSlug, interested: next }),
      })
      if (res.ok) setInterested(next)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
        interested
          ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
          : 'border-brand-border bg-white text-brand-muted hover:border-brand-blue hover:text-brand-blue'
      }`}
      title={interested ? 'You’ve offered to help — click to withdraw' : 'Offer to volunteer at this event'}
    >
      {interested ? <Check className="h-3.5 w-3.5" /> : <HandHeart className="h-3.5 w-3.5" />}
      {interested ? 'Offered to help' : 'Volunteer to help'}
    </button>
  )
}
