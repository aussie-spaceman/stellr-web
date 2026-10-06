'use client'

import { useState } from 'react'

export function WithdrawQuoteForm() {
  const [id, setId] = useState('')
  const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'done' | 'error'; message?: string }>({ kind: 'idle' })
  const submit = async () => {
    if (!window.confirm('Withdraw this quote permanently?')) return
    setState({ kind: 'busy' })
    const res = await fetch(`/api/admin/surveys/responses/${id.trim()}/withdraw-quote`, { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    setState(res.ok ? { kind: 'done', message: 'Withdrawn.' } : { kind: 'error', message: data.error ?? 'That didn’t work.' })
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <input
        value={id}
        onChange={(e) => setId(e.target.value)}
        placeholder="Response ID"
        aria-label="Response ID"
        className="w-80 rounded-lg border border-brand-border px-2 py-1.5"
      />
      <button
        type="button"
        className="rounded-lg border border-danger bg-white px-3 py-1.5 text-danger disabled:opacity-60"
        disabled={!/^[0-9a-f-]{36}$/.test(id.trim()) || state.kind === 'busy'}
        onClick={() => void submit()}
      >
        Withdraw quote
      </button>
      {state.message && <span className={state.kind === 'error' ? 'text-danger' : 'text-enviro-green-text'}>{state.message}</span>}
    </div>
  )
}
