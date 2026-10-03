'use client'

import { useState } from 'react'
import { Button } from '@stellr/web-ui'

export function SurveyLinkRequest({ slug }: { slug: string }) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setState('busy')
    const res = await fetch(`/api/survey/event/${slug}/link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }).catch(() => null)
    setState(res?.ok ? 'done' : 'error')
  }
  if (state === 'done') {
    return <p role="status" className="font-semibold text-enviro-green-text">If that address has a survey for this event, the link is on its way. Check your inbox (and spam).</p>
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm font-semibold text-ink" htmlFor="survey-email">Email</label>
      <input
        id="survey-email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-control border border-line px-3 py-2 text-ink"
      />
      <Button variant="primaryStrong" type="submit" disabled={state === 'busy'}>
        {state === 'busy' ? 'Sending…' : 'Email me my link'}
      </Button>
      {state === 'error' && <p role="alert" className="text-sm text-danger">That didn’t work. Wait a moment and try again.</p>}
    </form>
  )
}
