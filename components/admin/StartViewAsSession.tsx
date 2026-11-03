'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye } from 'lucide-react'
import { Button } from '@stellr/web-ui'

// The admin account summary reads a member's teams and billing through a
// view-as session: the same short-lived, audited ticket, bound to this admin,
// that the full-portal "View as member" uses. Until S0 (Nov 2026) these tabs
// passed ?memberId= instead, which let any admin read any member's data with
// nothing recorded.
export function StartViewAsSession({ memberId, what }: { memberId: string; what: string }) {
  const router = useRouter()
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setStarting(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/impersonation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? 'Could not start view-as. Try again.')
        return
      }
      // The response set the cookie; re-render the page so it sees it.
      router.refresh()
    } catch {
      setError('Couldn’t reach Stellr. Check the connection and try again.')
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="space-y-3 rounded-ds-card border border-line bg-white p-5">
      <p className="text-sm text-content-body">
        {what} open in a view-as session. Starting one is recorded on this member’s activity timeline. Until you
        select Exit view, or for 30 minutes, your whole member portal shows this member, read only.
      </p>
      <Button onClick={start} disabled={starting} className="min-h-11 px-4 py-2">
        <Eye className="h-4 w-4" aria-hidden /> {starting ? 'Starting…' : 'Start view-as session'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
