'use client'

import { useEffect, useState } from 'react'
import type { ClientView } from '@/lib/survey/access'
import { SurveyApp } from './SurveyApp'
import { SurveyAfterSubmit } from './SurveyAfterSubmit'
import { SurveyNotice } from './SurveyNotice'

// Opens the survey from the browser rather than during the server render, so
// an email security scanner prefetching the link doesn't count as an "open"
// or start a response.
export function SurveyLoader({ apiBase, signedIn }: { apiBase: string; signedIn: boolean }) {
  const [view, setView] = useState<ClientView | null>(null)
  const [state, setState] = useState<'loading' | 'error' | string>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch(`${apiBase}${window.location.search}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!live) return
        if (!res.ok) {
          setError(data.error ?? 'This survey isn’t available.')
          setState('error')
          return
        }
        if (data.definition) setView(data as ClientView)
        setState(data.state ?? 'error')
      })
      .catch(() => {
        if (live) {
          setError('We couldn’t load the survey. Check your connection and reload the page.')
          setState('error')
        }
      })
    return () => {
      live = false
    }
  }, [apiBase])

  if (state === 'loading') {
    return (
      <main className="min-h-screen bg-surface px-4 py-10 sm:py-16">
        <p className="mx-auto max-w-2xl text-content-muted">Opening your survey…</p>
      </main>
    )
  }
  if (view && (state === 'open' || state === 'submitted')) {
    if (state === 'submitted') {
      return (
        <main className="min-h-screen bg-surface px-4 py-10 sm:py-16">
          <div className="mx-auto max-w-2xl">
            <SurveyAfterSubmit eventTitle={view.context.event_title} signedIn={signedIn} justSubmitted={false} />
          </div>
        </main>
      )
    }
    return <SurveyApp apiBase={apiBase} view={view} signedIn={signedIn} />
  }
  return <SurveyNotice title="Survey unavailable">{error ?? 'This survey isn’t open right now.'}</SurveyNotice>
}
