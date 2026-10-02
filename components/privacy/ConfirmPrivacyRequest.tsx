'use client'

import { useEffect, useState } from 'react'

// Confirms a privacy request from the emailed link's fragment, then takes the
// key out of the address bar and history.

type State = 'working' | 'confirmed' | 'already_confirmed' | 'invalid'

const TEXT: Record<Exclude<State, 'working'>, { title: string; body: string }> = {
  confirmed: {
    title: 'Request confirmed',
    body: 'Thank you. We will answer within 30 days, by email. If we need anything else to find the right records, we will ask.',
  },
  already_confirmed: {
    title: 'Already confirmed',
    body: 'This request has been confirmed. We will answer within 30 days of the confirmation, by email.',
  },
  invalid: {
    title: 'This link can’t be used',
    body: 'It may have expired (links work for 7 days) or been used already. You can make the request again, or email privacy@stellreducation.org.',
  },
}

export function ConfirmPrivacyRequest() {
  const [state, setState] = useState<State>('working')

  useEffect(() => {
    const token = decodeURIComponent(window.location.hash.slice(1))
    window.history.replaceState(null, '', window.location.pathname)
    if (!token) return setState('invalid')
    void fetch('/api/privacy-requests/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      cache: 'no-store',
    })
      .then((r) => r.json())
      .then((d) => setState(d.state === 'confirmed' || d.state === 'already_confirmed' ? d.state : 'invalid'))
      .catch(() => setState('invalid'))
  }, [])

  return (
    <section aria-live="polite" className="rounded-ds-card border border-line bg-white p-6 sm:p-8">
      {state === 'working' ? (
        <p className="text-content-muted">Confirming your request…</p>
      ) : (
        <>
          <h1 className="font-display text-2xl font-bold text-ink">{TEXT[state].title}</h1>
          <p className="mt-3 text-content-body">{TEXT[state].body}</p>
          {state === 'invalid' && (
            <p className="mt-3"><a className="text-primary-deep underline" href="/privacy/request">Make a privacy request</a></p>
          )}
        </>
      )}
    </section>
  )
}
