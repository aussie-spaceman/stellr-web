'use client'

import { useId, useState } from 'react'

export interface MemberMatch {
  first_name: string
  last_name: string
}

// Stellr Member ID field with a lookup. Entering an existing participant's
// Member ID and accepting the match links this person to their on-file member
// record (the registration route resolves the ID server-side, builds the
// participant from that record, and never overwrites the member). Decline keeps
// the fields editable so the organiser can enter details manually. Only the
// matched name is returned to the browser — never the internal member id.
//
// deep review AUTH-4: the lookup also takes the person's last name and the server
// only confirms a match when it's correct. Member IDs are sequential, so without
// this an unauthenticated caller could walk them to harvest members' (minors'
// included) names; requiring the surname means a legitimate organiser linking one
// of their own people still succeeds, but the endpoint is no longer an ID→name
// directory. It doubles as a safety check that you're linking the right record.
export function MemberIdLookup({
  value,
  linked,
  linkedName,
  onChange,
  onAccept,
  onUnlink,
  label = 'Stellr Member ID',
}: {
  value: string
  linked: boolean
  linkedName?: string
  onChange: (v: string) => void
  onAccept: (m: MemberMatch) => void
  onUnlink: () => void
  label?: string
}) {
  const idFor = useId()
  const [status, setStatus] = useState<'idle' | 'searching' | 'found' | 'notfound' | 'limited' | 'error'>('idle')
  const [match, setMatch] = useState<MemberMatch | null>(null)
  // deep review AUTH-4: the surname the server matches the ID against. Required
  // before the lookup fires, so a bare ID never returns a name.
  const [lastName, setLastName] = useState('')

  async function lookup() {
    const id = value.trim()
    const surname = lastName.trim()
    if (!id || !surname) return
    setStatus('searching')
    setMatch(null)
    try {
      const res = await fetch(
        `/api/members/lookup?membership_id=${encodeURIComponent(id)}&last_name=${encodeURIComponent(surname)}`,
      )
      if (res.status === 429) {
        setStatus('limited')
        return
      }
      const data = await res.json()
      if (data.found) {
        setMatch({ first_name: data.first_name, last_name: data.last_name })
        setStatus('found')
      } else {
        setStatus('notfound')
      }
    } catch {
      setStatus('error')
    }
  }

  // Accepted/linked — show a compact confirmation; the rest of the form collapses.
  if (linked) {
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
      <label htmlFor={idFor} className="label-text">{label}</label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          id={idFor}
          value={value}
          inputMode="numeric"
          autoComplete="off"
          onChange={e => { onChange(e.target.value); setStatus('idle'); setMatch(null) }}
          className="input-field font-mono sm:flex-1"
          placeholder="e.g. 0000018 — if they already have a Stellr Member ID"
        />
        {/* deep review AUTH-4: confirm the surname — the server matches the ID
            against it, so a sequential-ID guess with the wrong name finds nothing. */}
        <input
          value={lastName}
          onChange={e => { setLastName(e.target.value); setStatus('idle'); setMatch(null) }}
          className="input-field sm:flex-1"
          placeholder="Their last name (to confirm)"
          aria-label="Their last name, to confirm the member ID"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={lookup}
          disabled={!value.trim() || !lastName.trim() || status === 'searching'}
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
            <button type="button" onClick={() => { setStatus('idle'); setMatch(null) }} className="text-xs text-content-body underline">Decline</button>
          </div>
        </div>
      )}
      {status === 'notfound' && <p className="text-xs text-content-muted mt-1">No member found with that ID and last name — check both, or enter their details below.</p>}
      {status === 'limited' && <p className="text-xs text-amber-600 mt-1">Too many lookups in a short time — wait a minute and try again, or enter their details below.</p>}
      {status === 'error' && <p className="text-xs text-red-500 mt-1">Lookup failed — enter their details below.</p>}
      <p className="text-xs text-content-faint mt-1">Leave blank if new to Stellr, or enter a Member ID to reuse their existing record and prevent duplicates.</p>
    </div>
  )
}
