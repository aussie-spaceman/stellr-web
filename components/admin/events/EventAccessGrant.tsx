'use client'

import { useEffect, useState } from 'react'
import { X, UserPlus } from 'lucide-react'
import MemberPicker, { type PickedMember } from '@/components/admin/MemberPicker'

interface GrantedMember {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  added_at: string
}

// Admin direct-grant for competition access (P3). Lets an admin/event-manager add
// a member to an event OUTSIDE the registration flow — the answer to "I just need
// to give this person access." Backed by /api/admin/events/[slug]/roster, which
// writes the event-level container roster the member portal resolves through.
export function EventAccessGrant({ slug }: { slug: string }) {
  const [members, setMembers] = useState<GrantedMember[]>([])
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = async () => {
    const res = await fetch(`/api/admin/events/${slug}/roster`)
    if (res.ok) setMembers((await res.json()).members ?? [])
    setLoaded(true)
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const add = async (m: PickedMember) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/events/${slug}/roster`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: m.id }),
      })
      if (res.ok) await load()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (memberId: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/events/${slug}/roster`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId }),
      })
      if (res.ok) setMembers((prev) => prev.filter((x) => x.id !== memberId))
    } finally {
      setBusy(false)
    }
  }

  const name = (m: GrantedMember) => [m.first_name, m.last_name].filter(Boolean).join(' ') || 'Member'

  return (
    <div className="rounded-xl border border-brand-border bg-white p-5">
      <div className="mb-1 flex items-center gap-2">
        <UserPlus className="h-4 w-4 text-brand-blue" />
        <h2 className="font-semibold text-brand-blue-dark">Grant access directly</h2>
      </div>
      <p className="mb-3 text-xs text-brand-muted-soft">
        Add a member to this competition without a registration — e.g. staff, a judge, or a late
        addition. They get portal access immediately. Registered participants appear on the roster
        above and aren&apos;t managed here.
      </p>

      <MemberPicker onPick={add} disabled={busy} placeholder="Add a member to this event…" />

      <ul className="mt-3 space-y-1.5">
        {loaded && members.length === 0 && (
          <li className="text-xs text-brand-muted-soft">No directly-granted members yet.</li>
        )}
        {members.map((m) => (
          <li
            key={m.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-brand-hairline px-3 py-1.5 text-sm"
          >
            <span>
              <span className="font-medium text-brand-blue-dark">{name(m)}</span>
              {m.email && <span className="ml-2 text-xs text-brand-muted-soft">{m.email}</span>}
            </span>
            <button
              onClick={() => remove(m.id)}
              disabled={busy}
              aria-label={`Revoke access for ${name(m)}`}
              className="text-brand-muted-soft hover:text-red-600 disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
