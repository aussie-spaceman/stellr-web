'use client'

import { useState } from 'react'

interface CheckInResult {
  firstName: string
  lastName: string
  shirtSize: string | null
  company: string | null
  alreadyCheckedIn: boolean
}

// Mobile-first check-in flow: enter email → big confirmation screen with
// name + shirt size so staff can hand over materials at a glance (PRD 6.7).
export default function CheckInForm({ slug, token, isVirtual }: { slug: string; token: string; isVirtual: boolean }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CheckInResult | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch('/api/check-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, token, email }),
    })
    const body = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) {
      setError(body?.error ?? 'Something went wrong. Please see the registration desk.')
      return
    }
    setResult(body)
  }

  if (result) {
    return (
      <div className="text-center space-y-6 py-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium text-green-700 uppercase tracking-wide">
            {result.alreadyCheckedIn ? 'Already checked in' : isVirtual ? 'Attendance confirmed' : 'Checked in'}
          </p>
          <h1 className="text-4xl font-extrabold text-ink mt-2">
            {result.firstName} {result.lastName}
          </h1>
          {result.company && <p className="text-lg font-semibold text-indigo-600 mt-2">{result.company}</p>}
        </div>
        {!isVirtual && result.shirtSize && (
          <div className="inline-block bg-ink text-white rounded-2xl px-10 py-6">
            <p className="text-xs uppercase tracking-wide text-content-faint">Shirt Size</p>
            <p className="text-5xl font-extrabold mt-1">{result.shirtSize}</p>
          </div>
        )}
        <p className="text-sm text-content-muted">
          {isVirtual ? 'You can close this page.' : 'Show this screen to the registration desk.'}
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm font-medium text-content-body">
        Email address you registered with
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          className="mt-1.5 w-full border border-line rounded-xl px-4 py-3 text-base"
          autoComplete="email"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={busy || !email}
        className="w-full bg-indigo-600 text-white font-semibold rounded-xl py-3.5 text-base disabled:opacity-50"
      >
        {busy ? 'Checking…' : isVirtual ? 'Confirm Attendance' : 'Check In'}
      </button>
    </form>
  )
}
