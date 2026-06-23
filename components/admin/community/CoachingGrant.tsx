'use client'

import { useEffect, useState } from 'react'
import { UserPlus, MessageCircle } from 'lucide-react'
import MemberPicker, { type PickedMember } from '@/components/admin/MemberPicker'

interface Workshop {
  id: string
  coach: string | null
  coachees: string[]
}

// Admin direct-grant for coaching (P3). Pair a coach with a coachee to create a
// coaching workshop (container + roster + chat). Backed by /api/admin/coaching.
export function CoachingGrant() {
  const [workshops, setWorkshops] = useState<Workshop[]>([])
  const [coach, setCoach] = useState<PickedMember | null>(null)
  const [coachee, setCoachee] = useState<PickedMember | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    const res = await fetch('/api/admin/coaching')
    if (res.ok) setWorkshops((await res.json()).workshops ?? [])
  }
  useEffect(() => {
    load()
  }, [])

  const name = (m: PickedMember) => [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email || 'Member'

  const create = async () => {
    if (!coach || !coachee) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/coaching', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coachId: coach.id, coacheeId: coachee.id }),
      })
      if (res.ok) {
        setCoach(null)
        setCoachee(null)
        await load()
      } else {
        setError((await res.json().catch(() => ({}))).error ?? 'Could not create workshop')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-brand-border bg-white p-5">
      <div className="mb-1 flex items-center gap-2">
        <MessageCircle className="h-4 w-4 text-brand-teal" />
        <h2 className="font-semibold text-brand-blue-dark">Coaching workshops</h2>
      </div>
      <p className="mb-3 text-xs text-brand-muted-soft">
        Pair a coach with a member to create a 1-on-1 coaching workshop. The member gets access to
        the workshop (chat &amp; sessions) immediately.
      </p>

      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-brand-muted-soft">Coach</label>
          {coach ? (
            <button
              onClick={() => setCoach(null)}
              className="w-full rounded-md border border-brand-border px-3 py-1.5 text-left text-sm hover:bg-brand-canvas"
            >
              {name(coach)} <span className="text-xs text-brand-muted-soft">· change</span>
            </button>
          ) : (
            <MemberPicker onPick={setCoach} placeholder="Choose a coach…" disabled={busy} />
          )}
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-brand-muted-soft">Member (coachee)</label>
          {coachee ? (
            <button
              onClick={() => setCoachee(null)}
              className="w-full rounded-md border border-brand-border px-3 py-1.5 text-left text-sm hover:bg-brand-canvas"
            >
              {name(coachee)} <span className="text-xs text-brand-muted-soft">· change</span>
            </button>
          ) : (
            <MemberPicker onPick={setCoachee} placeholder="Choose a member…" disabled={busy} />
          )}
        </div>
        <button
          onClick={create}
          disabled={busy || !coach || !coachee}
          className="mt-[18px] inline-flex items-center justify-center gap-1 rounded-md bg-brand-blue px-3 py-1.5 text-sm text-white hover:bg-brand-blue-dark disabled:opacity-40"
        >
          <UserPlus className="h-4 w-4" /> Create
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <ul className="mt-4 space-y-1.5">
        {workshops.length === 0 && (
          <li className="text-xs text-brand-muted-soft">No coaching workshops yet.</li>
        )}
        {workshops.map((w) => (
          <li key={w.id} className="rounded-lg border border-brand-hairline px-3 py-1.5 text-sm">
            <span className="font-medium text-brand-blue-dark">{w.coach ?? 'Coach'}</span>
            <span className="text-brand-muted-soft"> coaching </span>
            <span className="text-brand-blue-dark">{w.coachees.join(', ') || '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
