'use client'

import { useEffect, useState } from 'react'
import { Button } from '@stellr/web-ui'

// /sign/copy — the link in the "All signed" email. Reads the download key from
// the URL fragment, removes it from the address bar, and fetches a short-lived
// link to the signer's own copy.

type State = { kind: 'loading' } | { kind: 'ready'; url: string; filename: string } | { kind: 'error'; message: string }

export function SignedCopy() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    const token = decodeURIComponent(window.location.hash.slice(1))
    window.history.replaceState(null, '', window.location.pathname)
    if (!token) {
      setState({ kind: 'error', message: 'This link is incomplete. Open it again from your email.' })
      return
    }
    void fetch('/api/sign/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then(async (res) => ({ ok: res.ok, data: await res.json().catch(() => ({})) }))
      .then(({ ok, data }) => {
        if (ok && data.url) setState({ kind: 'ready', url: data.url, filename: data.filename })
        else setState({
          kind: 'error',
          message: data.message ?? 'This link has expired or can’t be used. Email privacy@stellreducation.org for a copy.',
        })
      })
  }, [])

  return (
    <main className="min-h-screen bg-surface px-4 py-10 sm:py-16">
      <section className="mx-auto max-w-xl rounded-ds-card border border-line bg-white p-6 sm:p-8" aria-live="polite">
        <h1 className="font-display text-2xl font-bold text-ink">Your signed copy</h1>
        {state.kind === 'loading' && <p className="mt-3 text-content-muted">Finding your document…</p>}
        {state.kind === 'error' && <p className="mt-3 text-content-body">{state.message}</p>}
        {state.kind === 'ready' && (
          <>
            <p className="mt-3 text-content-body">Download it and keep it somewhere safe. The download link works for two minutes; reload this page if it expires.</p>
            <div className="mt-6">
              <Button variant="primaryStrong" href={state.url} download={state.filename} rel="noopener noreferrer">Download the signed PDF</Button>
            </div>
          </>
        )}
      </section>
    </main>
  )
}
