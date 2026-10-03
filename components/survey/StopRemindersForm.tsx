'use client'

import { useState } from 'react'
import { Button } from '@stellr/web-ui'

export function StopRemindersForm({ token }: { token: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const stop = async () => {
    setState('busy')
    const res = await fetch(`/api/survey/${token}/stop-reminders`, { method: 'POST' }).catch(() => null)
    setState(res?.ok ? 'done' : 'error')
  }
  if (state === 'done') {
    return <p role="status" className="mt-6 font-semibold text-enviro-green-text">Done. You won’t get more reminders about this survey.</p>
  }
  return (
    <div className="mt-6">
      <Button variant="primaryStrong" onClick={() => void stop()} disabled={state === 'busy'}>
        {state === 'busy' ? 'Stopping…' : 'Stop reminders'}
      </Button>
      {state === 'error' && <p role="alert" className="mt-3 text-sm text-danger">That didn’t work. Check the link from your email and try again.</p>}
    </div>
  )
}
