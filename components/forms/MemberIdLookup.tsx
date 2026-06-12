'use client'

import { useState } from 'react'

export interface MemberMatch {
  member_id: string
  first_name: string
  last_name: string
}

// Stellr Member ID field with a lookup. Entering an existing participant's
// Member ID and accepting the match links this person to their on-file member
// record (the registration route then builds the participant from that record
// rather than re-collecting — and never overwrites the member). Decline keeps the
// fields editable so the organiser can enter details manually.
export function MemberIdLookup({
  value,
  linkedMemberId,
  linkedName,
  onChange,
  onAccept,
  onUnlink,
  label = 'Stellr Member ID',
}: {
  value: string
  linkedMemberId: string
  linkedName?: string
  onChange: (v: string) => void
  onAccept: (m: MemberMatch) => void
  onUnlink: () => void
  label?: string
}) {
  const [status, setStatus] = useState<'idle' | 'searching' | 'found' | 'notfound' | 'error'>('idle')
  const [match, setMatch] = useState<MemberMatch | null>(null)

  async function lookup() {
    const id = value.trim()
    if (!id) return
    setStatus('searching')
    setMatch(null)
    try {
      const res = await fetch(`/api/members/lookup?membership_id=${encodeURIComponent(id)}`)
      const data = await res.json()
      if (data.found) {
        setMatch(data as MemberMatch)
        setStatus('found')
      } else {
        setStatus('notfound')
      }
    } catch {
      setStatus('error')
    }
  }

  // Accepted/linked — show a compact confirmation; the rest of the form collapses.
  if (linkedMemberId) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 flex items-center justify-between gap-3">
        <p className="text-sm text-green-900">
          <span className="font-medium">{linkedName || 'Existing member'}</span>
          <span className="block text-xs text-green-700">Using their on-file Stellr record — no other details needed.</span>
        </p>
        <button type="button" onClick={onUnlink} className="text-xs text-green-800 underline whitespace-nowrap">
          Use different details
        </button>
      </div>
    )
  }

  return (
    <div>
      <label className="label-text">{label}</label>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={e => { onChange(e.target.value); setStatus('idle'); setMatch(null) }}
          className="input-field font-mono"
          placeholder="e.g. 0000018 — if they already have a Stellr Member ID"
        />
        <button
          type="button"
          onClick={lookup}
          disabled={!value.trim() || status === 'searching'}
          className="btn-outline px-4 whitespace-nowrap disabled:opacity-50"
        >
          {status === 'searching' ? 'Searching…' : 'Look up'}
        </button>
      </div>
      {status === 'found' && match && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 flex items-center justify-between gap-3">
          <span className="text-sm text-amber-900">Matched: <strong>{match.first_name} {match.last_name}</strong></span>
          <div className="flex gap-2">
            <button type="button" onClick={() => onAccept(match)} className="text-xs font-medium text-white bg-brand-blue rounded px-3 py-1">Accept</button>
            <button type="button" onClick={() => { setStatus('idle'); setMatch(null) }} className="text-xs text-gray-600 underline">Decline</button>
          </div>
        </div>
      )}
      {status === 'notfound' && <p className="text-xs text-gray-500 mt-1">No member found with that ID — enter their details below.</p>}
      {status === 'error' && <p className="text-xs text-red-500 mt-1">Lookup failed — enter their details below.</p>}
      <p className="text-xs text-gray-400 mt-1">Leave blank if new to Stellr, or enter a Member ID to reuse their existing record and prevent duplicates.</p>
    </div>
  )
}
