'use client'

import { useState } from 'react'
import { Mail } from 'lucide-react'

// Sends this week's digest email to the signed-in admin only, so the Friday
// email can be checked without waiting for Friday.
export function SendDigestButton() {
  const [state, setState] = useState<{ status: 'idle' | 'sending' | 'sent' | 'error'; message?: string }>({ status: 'idle' })

  async function send() {
    setState({ status: 'sending' })
    try {
      const res = await fetch('/api/admin/digest/send', { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { sentTo?: string; error?: string }
      if (!res.ok) throw new Error(body.error ?? 'The digest couldn’t be sent.')
      setState({ status: 'sent', message: `Sent to ${body.sentTo ?? 'your email'}` })
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : 'The digest couldn’t be sent.' })
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={send}
        disabled={state.status === 'sending'}
        className="inline-flex min-h-11 items-center gap-2 rounded-control border border-line bg-white px-4 text-sm font-medium text-content-body hover:bg-surface disabled:opacity-60"
      >
        <Mail className="h-4 w-4" aria-hidden="true" />
        {state.status === 'sending' ? 'Sending…' : 'Email me this week’s digest'}
      </button>
      <span role="status" className={`text-xs ${state.status === 'error' ? 'text-danger' : 'text-content-muted'}`}>
        {state.message}
      </span>
    </div>
  )
}
