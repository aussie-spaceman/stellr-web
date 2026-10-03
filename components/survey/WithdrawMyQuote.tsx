'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@stellr/web-ui'

export function WithdrawMyQuote({ responseId }: { responseId: string }) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'confirm' | 'busy' | 'error'>('idle')
  const withdraw = async () => {
    setState('busy')
    const res = await fetch(`/api/members/surveys/responses/${responseId}/withdraw-quote`, { method: 'POST' })
    if (res.ok) router.refresh()
    else setState('error')
  }
  if (state === 'confirm' || state === 'busy') {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <p className="text-sm text-ink">Stop Stellr quoting this response? This can’t be undone.</p>
        <Button variant="primaryStrong" onClick={() => void withdraw()} disabled={state === 'busy'}>
          {state === 'busy' ? 'Withdrawing…' : 'Yes, don’t quote it'}
        </Button>
        <Button variant="secondaryStrong" onClick={() => setState('idle')}>Cancel</Button>
      </div>
    )
  }
  return (
    <div className="mt-3">
      <Button variant="secondaryStrong" onClick={() => setState('confirm')}>Don’t quote this response</Button>
      {state === 'error' && <p role="alert" className="mt-2 text-sm text-danger">That didn’t work. Try again.</p>}
    </div>
  )
}
